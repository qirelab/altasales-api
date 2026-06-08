import { RecommendationGenerationJobService } from './recommendation-generation-job.service';
import { RecommendationGenerationStatus } from './entities/recommendation-generation-status.enum';

describe('RecommendationGenerationJobService', () => {
  const makeRepository = () => ({
    findOne: jest.fn(),
    create: jest.fn((entity) => entity),
    save: jest.fn((entity) => Promise.resolve(entity)),
    update: jest.fn().mockResolvedValue({ affected: 0 }),
  });
  const dataSource = {
    transaction: jest.fn(),
  };
  const processor = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('updates an existing pending generation job instead of creating a duplicate', async () => {
    const repository = makeRepository();
    const createdAt = new Date('2026-01-01T00:00:00.000Z');
    const updatedAt = new Date('2026-01-01T00:00:00.000Z');
    const pendingJob = {
      id: 'job-id',
      userId: 'user-id',
      status: RecommendationGenerationStatus.Pending,
      request: { clientProfile: { old: true } },
      result: [{ stale: true }],
      error: 'stale error',
      startedAt: new Date('2026-01-01T00:01:00.000Z'),
      completedAt: new Date('2026-01-01T00:02:00.000Z'),
      createdAt,
      updatedAt,
    };
    repository.findOne.mockResolvedValue(pendingJob);
    const service = new RecommendationGenerationJobService(
      repository as never,
      dataSource as never,
    );
    jest.spyOn(service, 'schedulePendingGenerationJobs').mockImplementation(jest.fn());

    const summary = await service.startGenerationForUser(
      'user-id',
      {
        clientProfile: { companyName: 'ACME' },
        diagnostics: ['diag'],
        limit: 3,
        persist: true,
      },
      processor,
    );

    expect(repository.create).not.toHaveBeenCalled();
    expect(repository.save).toHaveBeenCalledWith({
      ...pendingJob,
      request: {
        clientProfile: { companyName: 'ACME' },
        diagnostics: ['diag'],
        limit: 3,
        persist: true,
      },
      result: null,
      error: null,
      startedAt: null,
      completedAt: null,
    });
    expect(summary.id).toBe('job-id');
    expect(summary.result).toBeNull();
  });

  it('creates a generation job when no pending job exists', async () => {
    const repository = makeRepository();
    repository.findOne.mockResolvedValue(null);
    repository.save.mockImplementation((entity) => Promise.resolve({
      id: 'new-job-id',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      ...entity,
    }));
    const service = new RecommendationGenerationJobService(
      repository as never,
      dataSource as never,
    );
    jest.spyOn(service, 'schedulePendingGenerationJobs').mockImplementation(jest.fn());

    await service.startGenerationForUser(
      'user-id',
      { clientProfile: { companyName: 'ACME' } },
      processor,
    );

    expect(repository.create).toHaveBeenCalledWith({
      userId: 'user-id',
      status: RecommendationGenerationStatus.Pending,
      request: {
        clientProfile: { companyName: 'ACME' },
        diagnostics: [],
        limit: undefined,
        persist: true,
      },
      result: null,
      error: null,
      startedAt: null,
      completedAt: null,
    });
  });
});
