import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { UserRole } from '../users/entities/user-role.enum';
import { TranscriptionJob } from './entities/transcription-job.entity';
import { TranscriptionJobStatus } from './enums/transcription-job-status.enum';
import { TranscriptionJobsService } from './transcription-jobs.service';

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
  it('creates a queued job for the current user and starts async processing', async () => {
    const { service, repository, processor } = createService();
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
    expect(processor.runAsync).toHaveBeenCalledWith(
      expect.objectContaining({ id: JOB_ID, userId: USER.id }),
      file,
    );
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
      const { service, repository, processor } = createService();

      await expect(
        service.createFromUpload(USER, audioFile('call.mp3', 'audio/mpeg'), {
          language,
        }),
      ).rejects.toThrow(BadRequestException);

      expect(repository.create).not.toHaveBeenCalled();
      expect(repository.save).not.toHaveBeenCalled();
      expect(processor.runAsync).not.toHaveBeenCalled();
    },
  );

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
  const service = new TranscriptionJobsService(
    repository as never,
    processor as never,
  );

  return { service, repository, processor };
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
