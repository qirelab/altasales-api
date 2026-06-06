import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import * as fsPromises from 'fs/promises';
import { UserRole } from '../users/entities/user-role.enum';
import { TranscriptionJob } from './entities/transcription-job.entity';
import { TranscriptionJobStatus } from './enums/transcription-job-status.enum';
import { TranscriptionJobsService } from './transcription-jobs.service';

jest.mock('fs/promises', () => ({
  rm: jest.fn(),
}));

const USER = {
  id: '00000000-0000-4000-8000-000000000001',
  uid: 'firebase-user',
  email: 'user@example.com',
  emailVerified: true,
  role: UserRole.USER,
};
const OTHER_USER = {
  ...USER,
  id: '00000000-0000-4000-8000-000000000002',
  uid: 'firebase-other',
};
const ADMIN = {
  ...USER,
  id: '00000000-0000-4000-8000-000000000003',
  uid: 'firebase-admin',
  role: UserRole.ADMIN,
};
const JOB_ID = '00000000-0000-4000-8000-000000000010';

describe('TranscriptionJobsService', () => {
  const rmMock = fsPromises.rm as jest.MockedFunction<typeof fsPromises.rm>;

  beforeEach(() => {
    rmMock.mockReset();
    rmMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('creates a queued job for the current user and starts async processing', async () => {
    const { service, repository, audioProcessor } = createService();
    const file = audioFile('call.mp3', 'audio/mpeg');

    const result = await service.createFromUpload(USER, file, {
      language: 'ru-RU',
    });

    expect(result).toEqual({
      jobId: JOB_ID,
      status: TranscriptionJobStatus.QUEUED,
      createdAt: expect.any(Date),
    });
    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: USER.id,
        status: TranscriptionJobStatus.QUEUED,
        originalFileName: 'call.mp3',
        mimeType: 'audio/mpeg',
        size: file.size,
        language: 'ru-RU',
        provider: 'yandex_speechkit',
        text: null,
        segments: [],
      }),
    );
    expect(audioProcessor.runAsync).toHaveBeenCalledWith(
      expect.objectContaining({ id: JOB_ID, userId: USER.id }),
      file,
    );
  });

  it('creates a queued video job with original video metadata and starts video processing', async () => {
    const { service, repository, videoProcessor } = createService();
    const file = videoFile('demo.mp4', 'video/mp4');

    const result = await service.createFromVideoUpload(USER, file, {
      language: 'ru-RU',
    });

    expect(result).toEqual({
      jobId: JOB_ID,
      status: TranscriptionJobStatus.QUEUED,
      createdAt: expect.any(Date),
    });
    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: USER.id,
        status: TranscriptionJobStatus.QUEUED,
        originalFileName: 'demo.mp4',
        mimeType: 'video/mp4',
        size: file.size,
        language: 'ru-RU',
        provider: 'yandex_speechkit',
        text: null,
        segments: [],
      }),
    );
    expect(videoProcessor.runAsync).toHaveBeenCalledWith(
      expect.objectContaining({ id: JOB_ID, userId: USER.id }),
      file,
    );
    expect(rmMock).not.toHaveBeenCalled();
  });

  it('allows en-US language values', async () => {
    const { service, repository } = createService();
    const file = audioFile('call.mp3', 'audio/mpeg');

    await service.createFromUpload(USER, file, {
      language: 'en-US',
    });

    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({ language: 'en-US' }),
    );
  });

  it('uses configured default language when language is missing', async () => {
    const originalLanguage = process.env.YANDEX_SPEECHKIT_LANGUAGE;
    process.env.YANDEX_SPEECHKIT_LANGUAGE = 'en-US';
    const { service, repository } = createService();

    await service.createFromUpload(USER, audioFile('call.mp3', 'audio/mpeg'), {});

    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({ language: 'en-US' }),
    );
    if (originalLanguage === undefined) {
      delete process.env.YANDEX_SPEECHKIT_LANGUAGE;
    } else {
      process.env.YANDEX_SPEECHKIT_LANGUAGE = originalLanguage;
    }
  });

  it.each(['ru', 'ru-ru', 'ru-RU-extra-long-value'])(
    'rejects invalid language %s before creating a job',
    async (language) => {
      const { service, repository, audioProcessor, videoProcessor } = createService();

      await expect(
        service.createFromUpload(USER, audioFile('call.mp3', 'audio/mpeg'), {
          language,
        }),
      ).rejects.toThrow(BadRequestException);

      expect(repository.create).not.toHaveBeenCalled();
      expect(repository.save).not.toHaveBeenCalled();
      expect(audioProcessor.runAsync).not.toHaveBeenCalled();
      expect(videoProcessor.runAsync).not.toHaveBeenCalled();
    },
  );

  it('cleans uploaded temp video when language validation fails before processing starts', async () => {
    const { service, repository, videoProcessor } = createService();
    const file = videoFileFromPath('demo.mp4', 'video/mp4', '/tmp/upload/demo.mp4');

    await expect(
      service.createFromVideoUpload(USER, file, { language: 'ru' }),
    ).rejects.toThrow(BadRequestException);

    expect(repository.create).not.toHaveBeenCalled();
    expect(repository.save).not.toHaveBeenCalled();
    expect(videoProcessor.runAsync).not.toHaveBeenCalled();
    expect(rmMock).toHaveBeenCalledWith('/tmp/upload/demo.mp4', { force: true });
  });

  it('cleans uploaded temp video when job persistence fails before processing starts', async () => {
    const { service, repository, videoProcessor } = createService();
    const persistenceError = new Error('database unavailable');
    repository.save.mockRejectedValueOnce(persistenceError);
    const file = videoFileFromPath('demo.mp4', 'video/mp4', '/tmp/upload/demo.mp4');

    await expect(
      service.createFromVideoUpload(USER, file, { language: 'ru-RU' }),
    ).rejects.toBe(persistenceError);

    expect(videoProcessor.runAsync).not.toHaveBeenCalled();
    expect(rmMock).toHaveBeenCalledWith('/tmp/upload/demo.mp4', { force: true });
  });

  it('does not mask pre-processing video errors when temp cleanup fails', async () => {
    const { service } = createService();
    rmMock.mockRejectedValueOnce(new Error('cleanup failed with /tmp/upload/demo.mp4'));

    await expect(
      service.createFromVideoUpload(
        USER,
        videoFileFromPath('demo.mp4', 'video/mp4', '/tmp/upload/demo.mp4'),
        { language: 'ru' },
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('does not clean audio uploads on validation failure', async () => {
    const { service } = createService();

    await expect(
      service.createFromUpload(
        USER,
        audioFileFromPath('call.mp3', 'audio/mpeg', '/tmp/upload/call.mp3'),
        { language: 'ru' },
      ),
    ).rejects.toThrow(BadRequestException);

    expect(rmMock).not.toHaveBeenCalled();
  });

  it('allows owners and admins to read job metadata', async () => {
    const job = jobEntity({ userId: USER.id });
    const { service } = createService(job);

    await expect(service.getJobForUser(JOB_ID, USER)).resolves.toEqual(
      expect.objectContaining({
        id: JOB_ID,
        status: TranscriptionJobStatus.QUEUED,
        originalFileName: 'call.mp3',
      }),
    );
    await expect(service.getJobForUser(JOB_ID, ADMIN)).resolves.toEqual(
      expect.objectContaining({ id: JOB_ID }),
    );
  });

  it('rejects reads by another user', async () => {
    const { service } = createService(jobEntity({ userId: USER.id }));

    await expect(service.getJobForUser(JOB_ID, OTHER_USER)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('returns transcript only after success', async () => {
    const succeeded = jobEntity({
      status: TranscriptionJobStatus.SUCCEEDED,
      text: 'hello world',
      segments: [{ startMs: 0, endMs: 1000, text: 'hello world' }],
    });
    const { service } = createService(succeeded);

    await expect(service.getTranscriptForUser(JOB_ID, USER)).resolves.toEqual({
      jobId: JOB_ID,
      status: TranscriptionJobStatus.SUCCEEDED,
      text: 'hello world',
      segments: [{ startMs: 0, endMs: 1000, text: 'hello world' }],
    });
  });

  it('maps missing jobs to not found', async () => {
    const { service } = createService(null);

    await expect(service.getJobForUser(JOB_ID, USER)).rejects.toThrow(
      NotFoundException,
    );
  });
});

function createService(existingJob: TranscriptionJob | null = jobEntity()) {
  const repository = {
    create: jest.fn((entity) => ({ id: JOB_ID, createdAt: new Date(), ...entity })),
    save: jest.fn(async (entity) => entity),
    findOne: jest.fn(async () => existingJob),
  };
  const processor = {
    runAsync: jest.fn(),
  };
  const videoProcessor = {
    runAsync: jest.fn(),
  };
  const service = new TranscriptionJobsService(
    repository as never,
    processor as never,
    videoProcessor as never,
  );

  return {
    service,
    repository,
    audioProcessor: processor,
    videoProcessor,
  };
}

function jobEntity(overrides: Partial<TranscriptionJob> = {}): TranscriptionJob {
  return {
    id: JOB_ID,
    userId: USER.id,
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

function audioFileFromPath(
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
