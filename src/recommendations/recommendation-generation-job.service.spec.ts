import { DataSource, Repository } from 'typeorm';
import { RecommendationGenerationJobService } from './recommendation-generation-job.service';
import { RecommendationGenerationJob } from './entities/recommendation-generation-job.entity';
import { RecommendationGenerationStatus } from './entities/recommendation-generation-status.enum';

describe('RecommendationGenerationJobService', () => {
  let service: RecommendationGenerationJobService;
  let repository: {
    create: jest.Mock;
    save: jest.Mock;
    findOne: jest.Mock;
    update: jest.Mock;
  };
  let dataSource: DataSource;

  beforeEach(() => {
    repository = {
      create: jest.fn((value) => value),
      save: jest.fn((value) => Promise.resolve(value)),
      findOne: jest.fn(),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    dataSource = {} as DataSource;
    service = new RecommendationGenerationJobService(
      repository as unknown as Repository<RecommendationGenerationJob>,
      dataSource,
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  const processor = jest
    .fn()
    .mockResolvedValue([{ recommendationId: 'recommendation' }]);

  it('returns the existing job for a repeated idempotency key', async () => {
    const existingJob = {
      id: 'job-1',
      userId: 'user-1',
      idempotencyKey: 'request-1',
      status: RecommendationGenerationStatus.Processing,
      result: null,
      error: null,
      startedAt: null,
      completedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as RecommendationGenerationJob;
    repository.findOne.mockResolvedValue(existingJob);
    jest
      .spyOn(service, 'schedulePendingGenerationJobs')
      .mockImplementation(() => undefined);

    const result = await service.startGenerationForUser(
      'user-1',
      { limit: 5 },
      processor,
      'request-1',
    );

    expect(result.id).toBe('job-1');
    expect(repository.create).not.toHaveBeenCalled();
    expect(repository.save).not.toHaveBeenCalled();
  });

  it('resolves a concurrent insert through the unique idempotency constraint', async () => {
    const existingJob = {
      id: 'job-2',
      userId: 'user-1',
      idempotencyKey: 'request-2',
      status: RecommendationGenerationStatus.Pending,
      result: null,
      error: null,
      startedAt: null,
      completedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as RecommendationGenerationJob;
    repository.findOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(existingJob);
    repository.save.mockRejectedValue({ code: '23505' });
    jest
      .spyOn(service, 'schedulePendingGenerationJobs')
      .mockImplementation(() => undefined);

    const result = await service.startGenerationForUser(
      'user-1',
      { idempotencyKey: 'request-2' },
      processor,
    );

    expect(result.id).toBe('job-2');
    expect(repository.findOne).toHaveBeenCalledTimes(2);
  });

  it('claims a pending job with a fresh lease token and expiry', async () => {
    const job = {
      id: 'job-3',
      status: RecommendationGenerationStatus.Pending,
      error: 'old error',
    } as RecommendationGenerationJob;
    const queryBuilder = {
      where: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      setLock: jest.fn().mockReturnThis(),
      setOnLocked: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue(job),
    };
    const manager = {
      createQueryBuilder: jest.fn().mockReturnValue(queryBuilder),
      save: jest.fn().mockResolvedValue(job),
    };
    dataSource = {
      transaction: jest.fn((callback) => callback(manager)),
    } as unknown as DataSource;
    service = new RecommendationGenerationJobService(
      repository as unknown as Repository<RecommendationGenerationJob>,
      dataSource,
    );

    await (service as any).claimNextPendingJob();

    expect(job.status).toBe(RecommendationGenerationStatus.Processing);
    expect(job.leaseToken).toEqual(expect.any(String));
    expect(job.leaseExpiresAt).toEqual(expect.any(Date));
    expect(job.leaseExpiresAt!.getTime()).toBeGreaterThan(Date.now());
  });

  it('heartbeats long-running jobs and finalizes only its own lease', async () => {
    jest.useFakeTimers();
    let resolveProcessor!: (result: Record<string, unknown>[]) => void;
    const longRunningProcessor = jest.fn(
      () =>
        new Promise<Record<string, unknown>[]>(
          (resolve) => (resolveProcessor = resolve),
        ),
    );
    const job = {
      id: 'job-4',
      leaseToken: 'lease-4',
      status: RecommendationGenerationStatus.Processing,
    } as RecommendationGenerationJob;

    const processing = (service as any).processGenerationJob(
      job,
      longRunningProcessor,
    );
    jest.advanceTimersByTime(200_000);
    await Promise.resolve();

    expect(repository.update).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'job-4', leaseToken: 'lease-4' }),
      expect.objectContaining({ leaseExpiresAt: expect.any(Date) }),
    );

    resolveProcessor([{ recommendationId: 'recommendation-4' }]);
    await processing;
    expect(repository.update).toHaveBeenCalledWith(
      {
        id: 'job-4',
        status: RecommendationGenerationStatus.Processing,
        leaseToken: 'lease-4',
      },
      expect.objectContaining({
        status: RecommendationGenerationStatus.Completed,
      }),
    );
  });

  it('does not overwrite a job after its lease was lost', async () => {
    repository.update.mockResolvedValue({ affected: 0 });
    const job = {
      id: 'job-5',
      leaseToken: 'lease-5',
      status: RecommendationGenerationStatus.Processing,
    } as RecommendationGenerationJob;

    await (service as any).processGenerationJob(job, processor);

    expect(repository.save).not.toHaveBeenCalled();
    expect(repository.update).toHaveBeenCalledWith(
      {
        id: 'job-5',
        status: RecommendationGenerationStatus.Processing,
        leaseToken: 'lease-5',
      },
      expect.objectContaining({
        status: RecommendationGenerationStatus.Completed,
      }),
    );
  });

  it('recovers only expired or legacy stale processing jobs', async () => {
    await service.recoverInterruptedGenerationJobs();

    expect(repository.update).toHaveBeenCalledTimes(2);
    expect(repository.update).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        status: RecommendationGenerationStatus.Processing,
        leaseExpiresAt: expect.anything(),
      }),
      expect.objectContaining({
        status: RecommendationGenerationStatus.Pending,
        leaseToken: null,
        leaseExpiresAt: null,
      }),
    );
  });
});