import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TranscriptionJob } from '../entities/transcription-job.entity';
import { TranscriptionJobStatus } from '../enums/transcription-job-status.enum';
import {
  isTranscriptionProviderError,
  TranscriptionSafeErrorCode,
} from './transcription-provider-error';
import { VideoAudioExtractionService } from './video-audio-extraction.service';
import { YandexSpeechKitTranscriptionService } from './yandex-speechkit-transcription.service';

@Injectable()
export class VideoTranscriptionProcessingService {
  private readonly logger = new Logger(VideoTranscriptionProcessingService.name);

  constructor(
    @InjectRepository(TranscriptionJob)
    private readonly jobRepository: Repository<TranscriptionJob>,
    private readonly videoAudioExtraction: VideoAudioExtractionService,
    private readonly transcriptionService: YandexSpeechKitTranscriptionService,
  ) {}

  runAsync(job: TranscriptionJob, file: Express.Multer.File): void {
    this.run(job, file).catch(() => undefined);
  }

  async run(job: TranscriptionJob, file: Express.Multer.File): Promise<void> {
    const startedAt = Date.now();
    let audioFile: Express.Multer.File;

    try {
      audioFile = await this.videoAudioExtraction.extractAudio(file);
    } catch (error) {
      const errorCode = this.safeErrorCode(error);
      job.status = TranscriptionJobStatus.FAILED;
      job.errorCode = errorCode;
      job.safeErrorMessage = 'Transcription failed';
      job.finishedAt = new Date();
      await this.jobRepository.save(job);

      this.logger.error({
        eventName: 'TRANSCRIPTION_VIDEO_EXTRACTION_FAILED',
        jobId: job.id,
        userId: job.userId,
        provider: job.provider,
        status: job.status,
        errorCode,
        latencyMs: Date.now() - startedAt,
      });
      return;
    }

    await this.transcriptionService.run(job, audioFile);
  }

  private safeErrorCode(error: unknown): TranscriptionSafeErrorCode {
    return isTranscriptionProviderError(error)
      ? error.safeErrorCode
      : 'TRANSCRIPTION_VIDEO_EXTRACTION_FAILED';
  }
}
