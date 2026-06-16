import { Logger } from '@nestjs/common';
import * as fsPromises from 'fs/promises';
import { TranscriptionJob } from '../entities/transcription-job.entity';
import { TranscriptionJobStatus } from '../enums/transcription-job-status.enum';
import { TranscriptionProviderError } from './transcription-provider-error';
import { VideoTranscriptionProcessingService } from './video-transcription-processing.service';

jest.mock('fs/promises', () => ({
  rm: jest.fn(),
}));

const JOB_ID = '00000000-0000-4000-8000-000000000010';

describe('VideoTranscriptionProcessingService', () => {
  let loggerErrorSpy: jest.SpyInstance;
  let loggerWarnSpy: jest.SpyInstance;
  const rmMock = fsPromises.rm as jest.MockedFunction<typeof fsPromises.rm>;

  beforeEach(() => {
    loggerErrorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    loggerWarnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    rmMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('extracts audio and passes it to the existing SpeechKit transcription service', async () => {
    const { service, extractor, speechKit } = createService();
    const job = jobEntity({ mimeType: 'video/mp4' });
    const video = videoFile('demo.mp4', 'video/mp4');

    await service.run(job, video);

    expect(extractor.extractAudio).toHaveBeenCalledWith(video);
    expect(speechKit.run).toHaveBeenCalledWith(
      job,
      expect.objectContaining({
        originalname: 'extracted-audio.ogg',
        mimetype: 'audio/ogg',
      }),
    );
    expect(loggerErrorSpy).not.toHaveBeenCalled();
  });

  it('cleans the uploaded temp video file after processing finishes', async () => {
    const { service, speechKit } = createService();
    const job = jobEntity({ mimeType: 'video/mp4' });
    const video = videoFileFromPath('demo.mp4', 'video/mp4', '/tmp/upload/demo.mp4');

    await service.run(job, video);

    expect(speechKit.run).toHaveBeenCalled();
    expect(rmMock).toHaveBeenCalledWith('/tmp/upload/demo.mp4', {
      force: true,
    });
    expect(loggerWarnSpy).not.toHaveBeenCalled();
  });

  it('does not mask successful transcription when uploaded video cleanup fails', async () => {
    const { service, speechKit } = createService();
    rmMock.mockRejectedValueOnce(
      new Error('raw temp path cleanup failed'),
    );
    const job = jobEntity({ mimeType: 'video/mp4' });

    await service.run(
      job,
      videoFileFromPath('demo.mp4', 'video/mp4', '/tmp/upload/demo.mp4'),
    );

    expect(speechKit.run).toHaveBeenCalled();
    expect(loggerWarnSpy).toHaveBeenCalledWith({
      eventName: 'TRANSCRIPTION_VIDEO_UPLOAD_CLEANUP_FAILED',
      jobId: JOB_ID,
      provider: 'yandex_speechkit',
      errorCode: 'TRANSCRIPTION_VIDEO_UPLOAD_CLEANUP_FAILED',
    });
  });

  it('marks the job failed safely and skips SpeechKit when extraction fails', async () => {
    const { service, repository, extractor, speechKit } = createService();
    extractor.extractAudio.mockRejectedValueOnce(
      new TranscriptionProviderError(
        'TRANSCRIPTION_VIDEO_AUDIO_STREAM_NOT_FOUND',
        'Video audio stream not found',
      ),
    );
    const job = jobEntity({ mimeType: 'video/mp4' });

    await service.run(job, videoFile('demo.mp4', 'video/mp4'));

    expect(speechKit.run).not.toHaveBeenCalled();
    expect(repository.save).toHaveBeenLastCalledWith(
      expect.objectContaining({
        status: TranscriptionJobStatus.FAILED,
        errorCode: 'TRANSCRIPTION_VIDEO_AUDIO_STREAM_NOT_FOUND',
        safeErrorMessage: 'Transcription failed',
        text: null,
        segments: [],
      }),
    );
    expect(loggerErrorSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: 'TRANSCRIPTION_VIDEO_EXTRACTION_FAILED',
        jobId: JOB_ID,
        provider: 'yandex_speechkit',
        errorCode: 'TRANSCRIPTION_VIDEO_AUDIO_STREAM_NOT_FOUND',
      }),
    );
  });

  it('maps unexpected extraction failures to a safe extraction error', async () => {
    const { service, repository, extractor } = createService();
    extractor.extractAudio.mockRejectedValueOnce(
      new Error('raw ffmpeg stderr with /tmp/path'),
    );

    await service.run(jobEntity(), videoFile('demo.mp4', 'video/mp4'));

    expect(repository.save).toHaveBeenLastCalledWith(
      expect.objectContaining({
        status: TranscriptionJobStatus.FAILED,
        errorCode: 'TRANSCRIPTION_VIDEO_EXTRACTION_FAILED',
        safeErrorMessage: 'Transcription failed',
      }),
    );
  });
});

function createService() {
  const repository = {
    save: jest.fn(async (entity) => entity),
  };
  const extractor = {
    extractAudio: jest.fn(async () => audioFile('extracted-audio.ogg', 'audio/ogg')),
  };
  const speechKit = {
    run: jest.fn(async () => undefined),
  };
  const service = new VideoTranscriptionProcessingService(
    repository as never,
    extractor as never,
    speechKit as never,
  );

  return { service, repository, extractor, speechKit };
}

function jobEntity(overrides: Partial<TranscriptionJob> = {}): TranscriptionJob {
  return {
    id: JOB_ID,
    userId: '00000000-0000-4000-8000-000000000001',
    status: TranscriptionJobStatus.QUEUED,
    originalFileName: 'demo.mp4',
    mimeType: 'video/mp4',
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

function videoFile(
  originalname: string,
  mimetype: string,
): Express.Multer.File {
  const buffer = Buffer.from('video');
  return {
    originalname,
    mimetype,
    size: buffer.length,
    buffer,
  } as Express.Multer.File;
}

function videoFileFromPath(
  originalname: string,
  mimetype: string,
  path: string,
): Express.Multer.File {
  return {
    originalname,
    mimetype,
    size: 1024,
    path,
  } as Express.Multer.File;
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
