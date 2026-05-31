import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  TranscriptSegment,
  TranscriptionJob,
} from '../entities/transcription-job.entity';
import { TranscriptionJobStatus } from '../enums/transcription-job-status.enum';
import {
  isTranscriptionProviderError,
  TranscriptionProviderError,
  TranscriptionSafeErrorCode,
} from './transcription-provider-error';
import { UploadedAudioObject, YandexObjectStorageService } from './yandex-object-storage.service';

export const TRANSCRIPTION_FETCH = Symbol('TRANSCRIPTION_FETCH');

type Fetcher = typeof fetch;

type OperationResponse = {
  id?: unknown;
  done?: unknown;
  error?: unknown;
};

type RecognitionConfig = {
  apiKey: string;
  folderId: string;
  timeoutMs: number;
  pollIntervalMs: number;
};

const RECOGNIZE_URL =
  'https://stt.api.cloud.yandex.net:443/stt/v3/recognizeFileAsync';
const OPERATION_URL = 'https://operation.api.cloud.yandex.net/operations';
const GET_RECOGNITION_URL =
  'https://stt.api.cloud.yandex.net:443/stt/v3/getRecognition';
const DEFAULT_TIMEOUT_MS = 900_000;
const DEFAULT_POLL_INTERVAL_MS = 5_000;

@Injectable()
export class YandexSpeechKitTranscriptionService {
  private readonly logger = new Logger(YandexSpeechKitTranscriptionService.name);

  constructor(
    @InjectRepository(TranscriptionJob)
    private readonly jobRepository: Repository<TranscriptionJob>,
    private readonly objectStorage: YandexObjectStorageService,
    @Optional()
    @Inject(TRANSCRIPTION_FETCH)
    private readonly fetcher: Fetcher = fetch,
  ) {}

  runAsync(job: TranscriptionJob, file: Express.Multer.File): void {
    this.run(job, file).catch(() => undefined);
  }

  async run(job: TranscriptionJob, file: Express.Multer.File): Promise<void> {
    const startedAt = Date.now();

    try {
      const config = this.getConfig();
      job.status = TranscriptionJobStatus.RUNNING;
      job.startedAt = new Date();
      job.errorCode = null;
      job.safeErrorMessage = null;
      await this.jobRepository.save(job);

      const uploaded = await this.objectStorage.uploadAudio(job.id, file);
      job.objectStorageKey = uploaded.key;
      await this.jobRepository.save(job);

      const operationId = await this.startRecognition(job, uploaded, config);
      job.externalOperationId = operationId;
      await this.jobRepository.save(job);

      await this.waitForOperation(operationId, config);
      const transcript = await this.getRecognition(operationId, config);

      job.status = TranscriptionJobStatus.SUCCEEDED;
      job.text = transcript.text;
      job.segments = transcript.segments;
      job.errorCode = null;
      job.safeErrorMessage = null;
      job.finishedAt = new Date();
      await this.jobRepository.save(job);

      this.logger.log({
        eventName: 'TRANSCRIPTION_SUCCEEDED',
        jobId: job.id,
        userId: job.userId,
        provider: job.provider,
        status: job.status,
        latencyMs: Date.now() - startedAt,
      });
    } catch (error) {
      const errorCode = this.safeErrorCode(error);
      job.status = TranscriptionJobStatus.FAILED;
      job.errorCode = errorCode;
      job.safeErrorMessage = 'Transcription failed';
      job.finishedAt = new Date();
      await this.jobRepository.save(job);

      this.logger.error({
        eventName: 'TRANSCRIPTION_FAILED',
        jobId: job.id,
        userId: job.userId,
        provider: job.provider,
        status: job.status,
        errorCode,
        latencyMs: Date.now() - startedAt,
      });
    }
  }

  private async startRecognition(
    job: TranscriptionJob,
    uploaded: UploadedAudioObject,
    config: RecognitionConfig,
  ): Promise<string> {
    const response = await this.fetcher(RECOGNIZE_URL, {
      method: 'POST',
      headers: this.headers(config),
      body: JSON.stringify({
        uri: uploaded.uri,
        recognition_model: {
          model: 'general',
          language_restriction: {
            restriction_type: 'WHITELIST',
            language_code: [job.language],
          },
          audio_format: {
            container_audio: {
              container_audio_type: this.containerAudioType(job.mimeType),
            },
          },
        },
      }),
    });

    await this.assertOk(response);
    const body = (await response.json()) as OperationResponse;
    if (typeof body.id !== 'string' || !body.id) {
      throw new TranscriptionProviderError('TRANSCRIPTION_RESPONSE_INVALID');
    }
    return body.id;
  }

  private async waitForOperation(
    operationId: string,
    config: RecognitionConfig,
  ): Promise<void> {
    const deadline = Date.now() + config.timeoutMs;

    while (Date.now() < deadline) {
      const response = await this.fetcher(`${OPERATION_URL}/${operationId}`, {
        method: 'GET',
        headers: this.headers(config),
      });
      await this.assertOk(response);
      const body = (await response.json()) as OperationResponse;

      if (body.error) {
        throw new TranscriptionProviderError('TRANSCRIPTION_OPERATION_FAILED');
      }
      if (body.done === true) {
        return;
      }

      await this.sleep(config.pollIntervalMs);
    }

    throw new TranscriptionProviderError('TRANSCRIPTION_PROVIDER_TIMEOUT');
  }

  private async getRecognition(
    operationId: string,
    config: RecognitionConfig,
  ): Promise<{ text: string; segments: TranscriptSegment[] }> {
    const response = await this.fetcher(
      `${GET_RECOGNITION_URL}?operationId=${encodeURIComponent(operationId)}`,
      {
        method: 'GET',
        headers: this.headers(config),
      },
    );
    await this.assertOk(response);
    return this.normalizeRecognitionText(await response.text());
  }

  private normalizeRecognitionText(
    body: string,
  ): { text: string; segments: TranscriptSegment[] } {
    const payloads = this.parseRecognitionPayloads(body);
    const segments = payloads.flatMap((payload) =>
      this.extractAlternatives(payload).map((alternative) =>
        this.toSegment(alternative),
      ),
    ).filter((segment): segment is TranscriptSegment => Boolean(segment));
    const text = segments.map((segment) => segment.text).join(' ').trim();

    if (!text || segments.length === 0) {
      throw new TranscriptionProviderError('TRANSCRIPTION_RESPONSE_INVALID');
    }

    return { text, segments };
  }

  private parseRecognitionPayloads(body: string): unknown[] {
    const trimmed = body.trim();
    if (!trimmed) {
      throw new TranscriptionProviderError('TRANSCRIPTION_RESPONSE_INVALID');
    }

    try {
      const parsed = JSON.parse(trimmed);
      return Array.isArray(parsed) ? parsed : [parsed];
    } catch {
      try {
        return trimmed
          .split(/\n+/)
          .map((line) => line.trim())
          .filter(Boolean)
          .map((line) => JSON.parse(line));
      } catch {
        throw new TranscriptionProviderError('TRANSCRIPTION_RESPONSE_INVALID');
      }
    }
  }

  private extractAlternatives(payload: unknown): unknown[] {
    const payloadRecord = this.record(payload);
    const result = Object.keys(this.record(payloadRecord.result)).length > 0
      ? this.record(payloadRecord.result)
      : payloadRecord;
    const normalized = this.record(this.record(result.finalRefinement).normalizedText);
    const final = this.record(result.final);
    return [
      ...this.array(this.record(normalized).alternatives),
      ...this.array(this.record(final).alternatives),
    ];
  }

  private toSegment(alternative: unknown): TranscriptSegment | null {
    const record = this.record(alternative);
    const words = this.array(record.words).map((word) => this.record(word));
    const text = this.safeString(record.text)
      || words.map((word) => this.safeString(word.text)).filter(Boolean).join(' ');
    if (!text.trim()) {
      return null;
    }

    const startMs = this.safeInteger(record.startTimeMs)
      ?? this.safeInteger(words[0]?.startTimeMs)
      ?? 0;
    const endMs = this.safeInteger(record.endTimeMs)
      ?? this.safeInteger(words[words.length - 1]?.endTimeMs)
      ?? startMs;

    return {
      startMs,
      endMs,
      text: text.trim(),
      speaker: null,
      confidence: this.safeNumber(record.confidence),
    };
  }

  private async assertOk(response: Response): Promise<void> {
    if (response.ok) {
      return;
    }
    if (response.status === 429) {
      throw new TranscriptionProviderError('TRANSCRIPTION_PROVIDER_RATE_LIMITED');
    }
    if (response.status >= 500) {
      throw new TranscriptionProviderError('TRANSCRIPTION_PROVIDER_UNAVAILABLE');
    }
    throw new TranscriptionProviderError('TRANSCRIPTION_OPERATION_FAILED');
  }

  private getConfig(): RecognitionConfig {
    if (process.env.TRANSCRIPTION_ENABLED !== 'true') {
      throw new TranscriptionProviderError('TRANSCRIPTION_DISABLED');
    }

    const apiKey = process.env.YANDEX_SPEECHKIT_API_KEY?.trim();
    const folderId = process.env.YANDEX_SPEECHKIT_FOLDER_ID?.trim();
    if (!apiKey || !folderId) {
      throw new TranscriptionProviderError('TRANSCRIPTION_PROVIDER_UNAVAILABLE');
    }

    return {
      apiKey,
      folderId,
      timeoutMs: this.getPositiveInteger(
        process.env.TRANSCRIPTION_OPERATION_TIMEOUT_MS,
        DEFAULT_TIMEOUT_MS,
      ),
      pollIntervalMs: this.getPositiveInteger(
        process.env.TRANSCRIPTION_POLL_INTERVAL_MS,
        DEFAULT_POLL_INTERVAL_MS,
      ),
    };
  }

  private headers(config: RecognitionConfig): Record<string, string> {
    return {
      Authorization: `Api-Key ${config.apiKey}`,
      'x-folder-id': config.folderId,
      'Content-Type': 'application/json',
    };
  }

  private containerAudioType(mimeType: string): string {
    switch (mimeType) {
      case 'audio/mpeg':
        return 'MP3';
      case 'audio/ogg':
        return 'OGG_OPUS';
      case 'audio/wav':
      case 'audio/x-wav':
      default:
        return 'WAV';
    }
  }

  private safeErrorCode(error: unknown): TranscriptionSafeErrorCode {
    return isTranscriptionProviderError(error)
      ? error.safeErrorCode
      : 'TRANSCRIPTION_PROVIDER_UNAVAILABLE';
  }

  private getPositiveInteger(value: string | undefined, fallback: number): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }

  private record(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};
  }

  private array(value: unknown): unknown[] {
    return Array.isArray(value) ? value : [];
  }

  private safeString(value: unknown): string {
    return typeof value === 'string' ? value : '';
  }

  private safeInteger(value: unknown): number | undefined {
    const parsed = typeof value === 'number' ? value : Number(value);
    return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
  }

  private safeNumber(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  }
}
