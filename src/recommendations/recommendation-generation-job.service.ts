import {
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, LessThan, Repository } from 'typeorm';
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

const GENERATION_JOB_STALE_MS = 10 * 60 * 1000;
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
    dto: Omit<GenerateRecommendationsDto, 'userId'>,
    processor: GenerationJobProcessor,
  ): Promise<RecommendationGenerationJobSummary> {
    const job = await this.generationJobRepository.save(
      this.generationJobRepository.create({
        userId,
        status: RecommendationGenerationStatus.Pending,
        request: {
          clientProfile: dto.clientProfile ?? {},
          diagnostics: dto.diagnostics ?? [],
          limit: dto.limit,
          persist: dto.persist ?? true,
        },
        result: null,
        error: null,
        startedAt: null,
        completedAt: null,
      }),
    );

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
      throw new NotFoundException(`Recommendation generation job ${id} not found`);
    }

    return this.toSummary(job);
  }

  async recoverInterruptedGenerationJobs(): Promise<void> {
    const staleBefore = new Date(Date.now() - GENERATION_JOB_STALE_MS);
    await this.generationJobRepository.update(
      {
        status: RecommendationGenerationStatus.Processing,
        updatedAt: LessThan(staleBefore),
      },
      {
        status: RecommendationGenerationStatus.Pending,
        error: 'Recovered after service restart',
        startedAt: null,
      },
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

      return manager.save(job);
    });
  }

  private async processGenerationJob(
    job: RecommendationGenerationJob,
    processor: GenerationJobProcessor,
  ): Promise<void> {
    try {
      job.result = await processor(job);
      job.status = RecommendationGenerationStatus.Completed;
      job.completedAt = new Date();
      await this.generationJobRepository.save(job);
    } catch (error) {
      job.status = RecommendationGenerationStatus.Failed;
      job.error = error instanceof Error ? error.message : 'Generation failed';
      job.completedAt = new Date();
      await this.generationJobRepository.save(job);
    }
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
