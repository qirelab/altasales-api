import { randomUUID } from 'node:crypto';
import {
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, LessThan, MoreThan, Repository } from 'typeorm';
import { GenerateRecommendationsDto } from './dto/generate-recommendations.dto';
import { RecommendationGenerationJob } from './entities/recommendation-generation-job.entity';
import { RecommendationGenerationStatus } from './entities/recommendation-generation-status.enum';

export type RecommendationGenerationJobSummary = {
  id: string;
  status: RecommendationGenerationStatus;
  userId: string;
  result: Record<string, unknown>[] | null;
  error: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

type GenerationJobProcessor = (
  job: RecommendationGenerationJob,
) => Promise<Record<string, unknown>[]>;

type GenerationJobStartRequest = Omit<GenerateRecommendationsDto, 'userId'> & {
  idempotencyKey?: string;
};

const GENERATION_JOB_STALE_MS = 10 * 60 * 1000;
const GENERATION_JOB_LEASE_MS = GENERATION_JOB_STALE_MS;
const GENERATION_JOB_HEARTBEAT_MS = Math.floor(GENERATION_JOB_LEASE_MS / 3);
const GENERATION_JOB_BATCH_SIZE = 25;

@Injectable()
export class RecommendationGenerationJobService implements OnModuleDestroy {
  private readonly logger = new Logger(RecommendationGenerationJobService.name);
  private processingJobs = false;
  private rescheduleRequested = false;
  private recoveryInterval?: ReturnType<typeof setInterval>;

  constructor(
    @InjectRepository(RecommendationGenerationJob)
    private readonly generationJobRepository: Repository<RecommendationGenerationJob>,
    private readonly dataSource: DataSource,
  ) {}

  async startGenerationForUser(
    userId: string,
    dto: GenerationJobStartRequest,
    processor: GenerationJobProcessor,
    idempotencyKey?: string,
  ): Promise<RecommendationGenerationJobSummary> {
    const normalizedIdempotencyKey = this.normalizeIdempotencyKey(
      idempotencyKey ?? dto.idempotencyKey,
    );

    if (normalizedIdempotencyKey) {
      const existingJob = await this.generationJobRepository.findOne({
        where: { userId, idempotencyKey: normalizedIdempotencyKey },
      });
      if (existingJob) {
        this.schedulePendingGenerationJobs(processor);
        return this.toSummary(existingJob);
      }
    } else {
      const pendingJob = await this.generationJobRepository.findOne({
        where: { userId, status: RecommendationGenerationStatus.Pending },
        order: { createdAt: 'DESC' },
      });
      if (pendingJob) {
        await this.generationJobRepository.update(
          {
            id: pendingJob.id,
            userId,
            status: RecommendationGenerationStatus.Pending,
          },
          {
            request: this.buildRequest(dto) as any,
            result: null,
            error: null,
            startedAt: null,
            completedAt: null,
          },
        );
        const currentJob = await this.generationJobRepository.findOne({
          where: { id: pendingJob.id, userId },
        });
        if (currentJob) {
          this.schedulePendingGenerationJobs(processor);
          return this.toSummary(currentJob);
        }
      }
    }

    const jobToCreate = this.generationJobRepository.create({
      userId,
      idempotencyKey: normalizedIdempotencyKey,
      status: RecommendationGenerationStatus.Pending,
      request: this.buildRequest(dto) as any,
      result: null,
      error: null,
      startedAt: null,
      completedAt: null,
      leaseToken: null,
      leaseExpiresAt: null,
    });

    let job: RecommendationGenerationJob;
    try {
      job = await this.generationJobRepository.save(jobToCreate);
    } catch (error) {
      if (
        !normalizedIdempotencyKey ||
        !this.isUniqueConstraintViolation(error)
      ) {
        throw error;
      }
      const existingJob = await this.generationJobRepository.findOne({
        where: { userId, idempotencyKey: normalizedIdempotencyKey },
      });
      if (!existingJob) throw error;
      job = existingJob;
    }

    this.schedulePendingGenerationJobs(processor);
    return this.toSummary(job);
  }

  async findGenerationJobForUser(
    userId: string,
    id: string,
  ): Promise<RecommendationGenerationJobSummary> {
    const job = await this.generationJobRepository.findOne({
      where: { id, userId },
    });

    if (!job) {
      throw new NotFoundException(
        `Recommendation generation job ${id} not found`,
      );
    }

    return this.toSummary(job);
  }

  async recoverInterruptedGenerationJobs(): Promise<void> {
    const now = new Date();
    const recoveryUpdate = {
      status: RecommendationGenerationStatus.Pending,
      error: 'Recovered after lease expiration',
      startedAt: null,
      leaseToken: null,
      leaseExpiresAt: null,
    };
    await this.generationJobRepository.update(
      {
        status: RecommendationGenerationStatus.Processing,
        leaseExpiresAt: LessThan(now),
      },
      recoveryUpdate,
    );
    await this.generationJobRepository.update(
      {
        status: RecommendationGenerationStatus.Processing,
        leaseExpiresAt: IsNull(),
        updatedAt: LessThan(new Date(now.getTime() - GENERATION_JOB_STALE_MS)),
      },
      recoveryUpdate,
    );
  }

  startRecoveryLoop(processor: GenerationJobProcessor): void {
    if (this.recoveryInterval) return;
    this.recoveryInterval = setInterval(() => {
      void this.recoverInterruptedGenerationJobs()
        .then(() => this.schedulePendingGenerationJobs(processor))
        .catch((error) => {
          this.logger.error({
            eventName: 'RECOMMENDATION_GENERATION_RECOVERY_FAILED',
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        });
    }, GENERATION_JOB_STALE_MS);
  }

  onModuleDestroy(): void {
    if (this.recoveryInterval) {
      clearInterval(this.recoveryInterval);
    }
  }

  schedulePendingGenerationJobs(processor: GenerationJobProcessor): void {
    if (this.processingJobs) {
      this.rescheduleRequested = true;
      return;
    }
    this.processingJobs = true;

    void this.recoverInterruptedGenerationJobs()
      .then(() => this.processPendingGenerationJobs(processor))
      .catch((error) => {
        this.logger.error({
          eventName: 'RECOMMENDATION_GENERATION_WORKER_FAILED',
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      })
      .finally(() => {
        this.processingJobs = false;
        if (this.rescheduleRequested) {
          this.rescheduleRequested = false;
          this.schedulePendingGenerationJobs(processor);
        }
      });
  }

  private async processPendingGenerationJobs(
    processor: GenerationJobProcessor,
  ): Promise<void> {
    while (true) {
      let processed = 0;

      for (let i = 0; i < GENERATION_JOB_BATCH_SIZE; i += 1) {
        const job = await this.claimNextPendingJob();
        if (!job) break;
        processed += 1;
        await this.processGenerationJob(job, processor);
      }

      if (processed < GENERATION_JOB_BATCH_SIZE) {
        return;
      }
    }
  }

  private async claimNextPendingJob(): Promise<RecommendationGenerationJob | null> {
    return this.dataSource.transaction(async (manager) => {
      const job = await manager
        .createQueryBuilder(RecommendationGenerationJob, 'job')
        .where('job.status = :status', {
          status: RecommendationGenerationStatus.Pending,
        })
        .orderBy('job.createdAt', 'ASC')
        .setLock('pessimistic_write')
        .setOnLocked('skip_locked')
        .getOne();

      if (!job) return null;

      job.status = RecommendationGenerationStatus.Processing;
      job.startedAt = new Date();
      job.error = null;
      job.leaseToken = randomUUID();
      job.leaseExpiresAt = new Date(Date.now() + GENERATION_JOB_LEASE_MS);

      return manager.save(job);
    });
  }

  private async processGenerationJob(
    job: RecommendationGenerationJob,
    processor: GenerationJobProcessor,
  ): Promise<void> {
    const leaseToken = job.leaseToken;
    if (!leaseToken) {
      this.logger.warn({
        eventName: 'RECOMMENDATION_GENERATION_MISSING_LEASE',
        jobId: job.id,
      });
      return;
    }

    const heartbeat = setInterval(() => {
      void this.renewLease(job.id, leaseToken);
    }, GENERATION_JOB_HEARTBEAT_MS);

    try {
      const result = await this.withUserGenerationLock(job.userId, () =>
        processor(job),
      );
      const finalized = await this.generationJobRepository.update(
        {
          id: job.id,
          status: RecommendationGenerationStatus.Processing,
          leaseToken,
          leaseExpiresAt: MoreThan(new Date()),
        },
        {
          result: result as any,
          status: RecommendationGenerationStatus.Completed,
          completedAt: new Date(),
          leaseToken: null,
          leaseExpiresAt: null,
        },
      );
      this.logIfLeaseLost(job.id, finalized.affected);
    } catch (error) {
      const finalized = await this.generationJobRepository.update(
        {
          id: job.id,
          status: RecommendationGenerationStatus.Processing,
          leaseToken,
          leaseExpiresAt: MoreThan(new Date()),
        },
        {
          status: RecommendationGenerationStatus.Failed,
          error: error instanceof Error ? error.message : 'Generation failed',
          completedAt: new Date(),
          leaseToken: null,
          leaseExpiresAt: null,
        },
      );
      this.logIfLeaseLost(job.id, finalized.affected);
    } finally {
      clearInterval(heartbeat);
    }
  }

  private async renewLease(jobId: string, leaseToken: string): Promise<void> {
    try {
      const result = await this.generationJobRepository.update(
        {
          id: jobId,
          status: RecommendationGenerationStatus.Processing,
          leaseToken,
          leaseExpiresAt: MoreThan(new Date()),
        },
        { leaseExpiresAt: new Date(Date.now() + GENERATION_JOB_LEASE_MS) },
      );
      this.logIfLeaseLost(jobId, result.affected);
    } catch (error) {
      this.logger.error({
        eventName: 'RECOMMENDATION_GENERATION_HEARTBEAT_FAILED',
        jobId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  private logIfLeaseLost(jobId: string, affected?: number | null): void {
    if (affected === 0) {
      this.logger.warn({
        eventName: 'RECOMMENDATION_GENERATION_LEASE_LOST',
        jobId,
      });
    }
  }

  private async withUserGenerationLock<T>(
    userId: string,
    processor: () => Promise<T>,
  ): Promise<T> {
    const queryRunner = this.dataSource.createQueryRunner();
    let transactionStarted = false;

    try {
      await queryRunner.connect();
      await queryRunner.startTransaction();
      transactionStarted = true;
      await queryRunner.query(
        'SELECT pg_advisory_xact_lock(hashtext($1))',
        [userId],
      );

      const result = await processor();
      await queryRunner.commitTransaction();
      return result;
    } catch (error) {
      if (transactionStarted) {
        await queryRunner.rollbackTransaction();
      }
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  private buildRequest(
    dto: GenerationJobStartRequest,
  ): Record<string, unknown> {
    return {
      clientProfile: dto.clientProfile ?? {},
      diagnostics: dto.diagnostics ?? [],
      limit: dto.limit,
      persist: dto.persist ?? true,
    };
  }

  private normalizeIdempotencyKey(key?: string): string | null {
    const normalized = key?.trim();
    return normalized ? normalized : null;
  }

  private isUniqueConstraintViolation(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: string }).code === '23505'
    );
  }

  private toSummary(
    job: RecommendationGenerationJob,
  ): RecommendationGenerationJobSummary {
    return {
      id: job.id,
      status: job.status,
      userId: job.userId,
      result: job.result,
      error: job.error,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    };
  }
}
