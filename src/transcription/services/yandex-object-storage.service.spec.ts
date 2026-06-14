import { Logger } from '@nestjs/common';
import { YandexObjectStorageService } from './yandex-object-storage.service';
import { TranscriptionProviderError } from './transcription-provider-error';

describe('YandexObjectStorageService', () => {
  const env = process.env;
  let loggerErrorSpy: jest.SpyInstance;
  let loggerLogSpy: jest.SpyInstance;

  beforeEach(() => {
    process.env = {
      ...env,
      YANDEX_OBJECT_STORAGE_BUCKET: 'transcription-bucket',
      YANDEX_OBJECT_STORAGE_REGION: 'ru-central1',
      YANDEX_OBJECT_STORAGE_ACCESS_KEY_ID: 'access-key',
      YANDEX_OBJECT_STORAGE_SECRET_ACCESS_KEY: 'secret-key',
    };
    loggerErrorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    loggerLogSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();
  });

  afterEach(() => {
    process.env = env;
    jest.restoreAllMocks();
  });

  it('uploads audio with a safe generated object key', async () => {
    const client = { send: jest.fn().mockResolvedValue({}) };
    const service = new YandexObjectStorageService(client as never);

    const result = await service.uploadAudio(
      '00000000-0000-4000-8000-000000000010',
      file('sales call 01.mp3', 'audio/mpeg'),
    );

    expect(result).toEqual({
      key: 'transcription/00000000-0000-4000-8000-000000000010/sales-call-01.mp3',
      uri: 'https://storage.yandexcloud.net/transcription-bucket/transcription/00000000-0000-4000-8000-000000000010/sales-call-01.mp3',
    });
    expect(client.send).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          Bucket: 'transcription-bucket',
          Key: result.key,
          Body: expect.any(Buffer),
          ContentType: 'audio/mpeg',
        }),
      }),
    );
    expect(loggerLogSpy).not.toHaveBeenCalled();
    expect(loggerErrorSpy).not.toHaveBeenCalledWith(
      expect.stringContaining('secret-key'),
    );
  });

  it('fails safely when Object Storage config is missing', async () => {
    delete process.env.YANDEX_OBJECT_STORAGE_BUCKET;
    const service = new YandexObjectStorageService({ send: jest.fn() } as never);

    await expect(
      service.uploadAudio('job-1', file('call.mp3', 'audio/mpeg')),
    ).rejects.toMatchObject<Partial<TranscriptionProviderError>>({
      safeErrorCode: 'TRANSCRIPTION_UPLOAD_FAILED',
    });
  });

  it('fails readiness safely when Object Storage config is missing', () => {
    delete process.env.YANDEX_OBJECT_STORAGE_BUCKET;
    const client = { send: jest.fn() };
    const service = new YandexObjectStorageService(client as never);

    try {
      service.assertReadyForUpload();
      throw new Error('Expected readiness check to fail');
    } catch (error) {
      expect(error).toMatchObject<Partial<TranscriptionProviderError>>({
        safeErrorCode: 'TRANSCRIPTION_CONFIG_MISSING',
        message: 'Transcription configuration is missing',
      });
    }
    expect(client.send).not.toHaveBeenCalled();
  });

  it('passes readiness without SDK calls when Object Storage config exists', () => {
    const client = { send: jest.fn() };
    const service = new YandexObjectStorageService(client as never);

    service.assertReadyForUpload();

    expect(client.send).not.toHaveBeenCalled();
  });

  it('deletes temporary audio objects with a safe bucket-scoped request', async () => {
    const client = { send: jest.fn().mockResolvedValue({}) };
    const service = new YandexObjectStorageService(client as never);

    await service.deleteObject('transcription/job-1/call.mp3');

    expect(client.send).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          Bucket: 'transcription-bucket',
          Key: 'transcription/job-1/call.mp3',
        }),
      }),
    );
    expect(loggerLogSpy).not.toHaveBeenCalled();
    expect(loggerErrorSpy).not.toHaveBeenCalled();
  });

  it('skips delete safely when the object key is empty', async () => {
    const client = { send: jest.fn() };
    const service = new YandexObjectStorageService(client as never);

    await service.deleteObject('   ');

    expect(client.send).not.toHaveBeenCalled();
  });

  it('fails delete safely when Object Storage config is missing', async () => {
    delete process.env.YANDEX_OBJECT_STORAGE_BUCKET;
    const service = new YandexObjectStorageService({ send: jest.fn() } as never);

    await expect(
      service.deleteObject('transcription/job-1/call.mp3'),
    ).rejects.toMatchObject<Partial<TranscriptionProviderError>>({
      safeErrorCode: 'TRANSCRIPTION_OBJECT_CLEANUP_FAILED',
    });
  });

  it('maps SDK delete failures to safe errors without exposing raw details', async () => {
    const service = new YandexObjectStorageService({
      send: jest.fn().mockRejectedValue(
        new Error(
          'secret-key https://storage.yandexcloud.net/transcription-bucket/transcription/job-1/call.mp3',
        ),
      ),
    } as never);

    await expect(
      service.deleteObject('transcription/job-1/call.mp3'),
    ).rejects.toMatchObject<Partial<TranscriptionProviderError>>({
      safeErrorCode: 'TRANSCRIPTION_OBJECT_CLEANUP_FAILED',
      message: 'Temporary audio cleanup failed',
    });
  });

  it('maps SDK upload failures to safe errors', async () => {
    const service = new YandexObjectStorageService({
      send: jest.fn().mockRejectedValue(new Error('raw sdk failure')),
    } as never);

    await expect(
      service.uploadAudio('job-1', file('call.mp3', 'audio/mpeg')),
    ).rejects.toMatchObject<Partial<TranscriptionProviderError>>({
      safeErrorCode: 'TRANSCRIPTION_UPLOAD_FAILED',
    });
  });
});

function file(originalname: string, mimetype: string): Express.Multer.File {
  const buffer = Buffer.from('audio');
  return {
    originalname,
    mimetype,
    size: buffer.length,
    buffer,
  } as Express.Multer.File;
}
