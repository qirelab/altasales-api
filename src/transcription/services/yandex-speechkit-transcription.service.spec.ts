import { Logger } from '@nestjs/common';
import { TranscriptionJob } from '../entities/transcription-job.entity';
import { TranscriptionJobStatus } from '../enums/transcription-job-status.enum';
import { YandexSpeechKitTranscriptionService } from './yandex-speechkit-transcription.service';

const JOB_ID = '00000000-0000-4000-8000-000000000010';

describe('YandexSpeechKitTranscriptionService', () => {
  const env = process.env;
  let loggerLogSpy: jest.SpyInstance;
  let loggerErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    process.env = {
      ...env,
      TRANSCRIPTION_ENABLED: 'true',
      TRANSCRIPTION_OPERATION_TIMEOUT_MS: '1000',
      TRANSCRIPTION_POLL_INTERVAL_MS: '1',
      YANDEX_SPEECHKIT_API_KEY: 'speechkit-key',
      YANDEX_SPEECHKIT_FOLDER_ID: 'folder-id',
    };
    loggerLogSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    loggerErrorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });

  afterEach(() => {
    process.env = env;
    jest.restoreAllMocks();
  });

  it('fails safely before upload when transcription is disabled', async () => {
    process.env.TRANSCRIPTION_ENABLED = 'false';
    const { service, storage, repository } = createService();
    const job = jobEntity();

    await service.run(job, audioFile('call.mp3', 'audio/mpeg'));

    expect(storage.uploadAudio).not.toHaveBeenCalled();
    expect(repository.save).toHaveBeenLastCalledWith(
      expect.objectContaining({
        status: TranscriptionJobStatus.FAILED,
        errorCode: 'TRANSCRIPTION_DISABLED',
        safeErrorMessage: 'Transcription failed',
      }),
    );
  });

  it('uploads audio, starts recognition, polls, and saves normalized transcript', async () => {
    const fetcher = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse({ id: 'operation-1', done: false }))
      .mockResolvedValueOnce(jsonResponse({ id: 'operation-1', done: false }))
      .mockResolvedValueOnce(jsonResponse({ id: 'operation-1', done: true }))
      .mockResolvedValueOnce(
        textResponse(
          JSON.stringify({
            result: {
              finalRefinement: {
                normalizedText: {
                  alternatives: [
                    {
                      text: 'Hello world',
                      startTimeMs: '100',
                      endTimeMs: '1200',
                      confidence: 0.91,
                    },
                  ],
                },
              },
            },
          }),
        ),
      );
    const { service, repository } = createService(fetcher);
    const job = jobEntity({ mimeType: 'audio/mpeg', language: 'ru-RU' });

    await service.run(job, audioFile('call.mp3', 'audio/mpeg'));

    expect(fetcher).toHaveBeenNthCalledWith(
      1,
      'https://stt.api.cloud.yandex.net:443/stt/v3/recognizeFileAsync',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Api-Key speechkit-key',
          'x-folder-id': 'folder-id',
        }),
        body: expect.stringContaining('"container_audio_type":"MP3"'),
      }),
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      4,
      'https://stt.api.cloud.yandex.net:443/stt/v3/getRecognition?operationId=operation-1',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(repository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        externalOperationId: 'operation-1',
      }),
    );
    expect(repository.save).toHaveBeenLastCalledWith(
      expect.objectContaining({
        status: TranscriptionJobStatus.SUCCEEDED,
        text: 'Hello world',
        segments: [
          {
            startMs: 100,
            endMs: 1200,
            text: 'Hello world',
            speaker: null,
            confidence: 0.91,
          },
        ],
        errorCode: null,
        safeErrorMessage: null,
      }),
    );
    expect(loggerLogSpy).toHaveBeenCalledWith(
      expect.not.objectContaining({ text: 'Hello world' }),
    );
    expect(loggerErrorSpy).not.toHaveBeenCalled();
  });

  it('normalizes direct top-level finalRefinement responses from current API', async () => {
    const fetcher = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse({ id: 'operation-1', done: false }))
      .mockResolvedValueOnce(jsonResponse({ id: 'operation-1', done: true }))
      .mockResolvedValueOnce(
        textResponse(
          JSON.stringify({
            finalRefinement: {
              normalizedText: {
                alternatives: [
                  {
                    text: 'Direct response',
                    startTimeMs: '200',
                    endTimeMs: '1600',
                  },
                ],
              },
            },
          }),
        ),
      );
    const { service, repository } = createService(fetcher);

    await service.run(jobEntity(), audioFile('call.mp3', 'audio/mpeg'));

    expect(repository.save).toHaveBeenLastCalledWith(
      expect.objectContaining({
        status: TranscriptionJobStatus.SUCCEEDED,
        text: 'Direct response',
        segments: [
          {
            startMs: 200,
            endMs: 1600,
            text: 'Direct response',
            speaker: null,
            confidence: null,
          },
        ],
      }),
    );
  });

  it('marks timeout as a safe provider timeout', async () => {
    process.env.TRANSCRIPTION_OPERATION_TIMEOUT_MS = '1';
    process.env.TRANSCRIPTION_POLL_INTERVAL_MS = '1';
    const fetcher = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse({ id: 'operation-1', done: false }))
      .mockResolvedValue(jsonResponse({ id: 'operation-1', done: false }));
    const { service, repository } = createService(fetcher);

    await service.run(jobEntity(), audioFile('call.wav', 'audio/wav'));

    expect(repository.save).toHaveBeenLastCalledWith(
      expect.objectContaining({
        status: TranscriptionJobStatus.FAILED,
        errorCode: 'TRANSCRIPTION_PROVIDER_TIMEOUT',
        safeErrorMessage: 'Transcription failed',
      }),
    );
  });

  it('maps empty recognition results to safe invalid response failure', async () => {
    const fetcher = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse({ id: 'operation-1', done: false }))
      .mockResolvedValueOnce(jsonResponse({ id: 'operation-1', done: true }))
      .mockResolvedValueOnce(textResponse('{"result":{}}'));
    const { service, repository } = createService(fetcher);

    await service.run(jobEntity(), audioFile('call.ogg', 'audio/ogg'));

    expect(repository.save).toHaveBeenLastCalledWith(
      expect.objectContaining({
        status: TranscriptionJobStatus.FAILED,
        errorCode: 'TRANSCRIPTION_RESPONSE_INVALID',
      }),
    );
  });
});

function createService(fetcher: jest.Mock = jest.fn()) {
  const repository = {
    save: jest.fn(async (entity) => entity),
  };
  const storage = {
    uploadAudio: jest.fn(async () => ({
      key: `transcription/${JOB_ID}/call.mp3`,
      uri: 'https://storage.yandexcloud.net/bucket/transcription/job/call.mp3',
    })),
  };
  const service = new YandexSpeechKitTranscriptionService(
    repository as never,
    storage as never,
    fetcher as never,
  );

  return { service, repository, storage };
}

function jobEntity(overrides: Partial<TranscriptionJob> = {}): TranscriptionJob {
  return {
    id: JOB_ID,
    userId: '00000000-0000-4000-8000-000000000001',
    status: TranscriptionJobStatus.QUEUED,
    originalFileName: 'call.mp3',
    mimeType: 'audio/mpeg',
    size: 1024,
    language: 'ru-RU',
    provider: 'yandex_speechkit',
    externalOperationId: null,
    objectStorageKey: null,
    text: null,
    segments: [],
    errorCode: null,
    safeErrorMessage: null,
    startedAt: null,
    finishedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as TranscriptionJob;
}

function audioFile(
  originalname: string,
  mimetype: string,
): Express.Multer.File {
  const buffer = Buffer.from('audio');
  return {
    originalname,
    mimetype,
    size: buffer.length,
    buffer,
  } as Express.Multer.File;
}

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: jest.fn(async () => body),
  } as unknown as Response;
}

function textResponse(body: string): Response {
  return {
    ok: true,
    status: 200,
    text: jest.fn(async () => body),
  } as unknown as Response;
}
