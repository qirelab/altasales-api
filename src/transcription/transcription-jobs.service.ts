import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { CurrentUserData } from '../auth/decorators/current-user.decorator';
import { UserRole } from '../users/entities/user-role.enum';
import {
  TranscriptionCreateJobResponseDto,
  TranscriptionJobResponseDto,
} from './dto/transcription-job-response.dto';
import { TranscriptionTranscriptResponseDto } from './dto/transcription-transcript-response.dto';
import { TranscriptionJob } from './entities/transcription-job.entity';
import { TranscriptionJobStatus } from './enums/transcription-job-status.enum';
import { VideoTranscriptionProcessingService } from './services/video-transcription-processing.service';
import { YandexSpeechKitTranscriptionService } from './services/yandex-speechkit-transcription.service';

const DEFAULT_LANGUAGE = 'ru-RU';
const LANGUAGE_PATTERN = /^[a-z]{2}-[A-Z]{2}$/;

@Injectable()
export class TranscriptionJobsService {
  constructor(
    @InjectRepository(TranscriptionJob)
    private readonly jobRepository: Repository<TranscriptionJob>,
    private readonly transcriptionService: YandexSpeechKitTranscriptionService,
    private readonly videoTranscriptionService: VideoTranscriptionProcessingService,
  ) {}

  createFromUpload(
    user: CurrentUserData,
    file: Express.Multer.File,
    input: { language?: string },
  ): Promise<TranscriptionCreateJobResponseDto> {
    return this.createJob(user, file, input, (job) => {
      this.transcriptionService.runAsync(job, file);
    });
  }

  createFromVideoUpload(
    user: CurrentUserData,
    file: Express.Multer.File,
    input: { language?: string },
  ): Promise<TranscriptionCreateJobResponseDto> {
    return this.createJob(user, file, input, (job) => {
      this.videoTranscriptionService.runAsync(job, file);
    });
  }

  async getJobForUser(
    id: string,
    user: CurrentUserData,
  ): Promise<TranscriptionJobResponseDto> {
    const job = await this.findAccessibleJob(id, user);
    return this.toJobResponse(job);
  }

  async getTranscriptForUser(
    id: string,
    user: CurrentUserData,
  ): Promise<TranscriptionTranscriptResponseDto> {
    const job = await this.findAccessibleJob(id, user);
    if (job.status !== TranscriptionJobStatus.SUCCEEDED || !job.text) {
      throw new BadRequestException('Transcription is not ready');
    }

    return {
      jobId: job.id,
      status: job.status,
      text: job.text,
      segments: job.segments,
    };
  }

  private async createJob(
    user: CurrentUserData,
    file: Express.Multer.File,
    input: { language?: string },
    startProcessing: (job: TranscriptionJob) => void,
  ): Promise<TranscriptionCreateJobResponseDto> {
    const language = this.resolveLanguage(input.language);
    const job = await this.jobRepository.save(
      this.jobRepository.create({
        userId: user.id,
        status: TranscriptionJobStatus.QUEUED,
        originalFileName: file.originalname,
        mimeType: file.mimetype,
        size: file.size,
        language,
        provider: 'yandex_speechkit',
        externalOperationId: null,
        objectStorageKey: null,
        text: null,
        segments: [],
        errorCode: null,
        safeErrorMessage: null,
        startedAt: null,
        finishedAt: null,
      }),
    );

    startProcessing(job);

    return {
      jobId: job.id,
      status: job.status,
      createdAt: job.createdAt,
    };
  }

  private async findAccessibleJob(
    id: string,
    user: CurrentUserData,
  ): Promise<TranscriptionJob> {
    const job = await this.jobRepository.findOne({ where: { id } });
    if (!job) {
      throw new NotFoundException('Transcription job not found');
    }

    if (job.userId !== user.id && user.role !== UserRole.ADMIN) {
      throw new ForbiddenException('Insufficient permissions');
    }

    return job;
  }

  private toJobResponse(job: TranscriptionJob): TranscriptionJobResponseDto {
    return {
      id: job.id,
      status: job.status,
      originalFileName: job.originalFileName,
      mimeType: job.mimeType,
      size: job.size,
      language: job.language,
      provider: job.provider,
      errorCode: job.errorCode,
      safeErrorMessage: job.safeErrorMessage,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      finishedAt: job.finishedAt,
    };
  }

  private resolveLanguage(language: string | undefined): string {
    const resolved = language?.trim()
      || process.env.YANDEX_SPEECHKIT_LANGUAGE?.trim()
      || DEFAULT_LANGUAGE;

    if (resolved.length > 20 || !LANGUAGE_PATTERN.test(resolved)) {
      throw new BadRequestException('Transcription language is invalid');
    }

    return resolved;
  }
}
