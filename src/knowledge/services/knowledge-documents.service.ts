import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, Repository } from 'typeorm';
import { KnowledgeChunk } from '../entities/knowledge-chunk.entity';
import { KnowledgeDocument } from '../entities/knowledge-document.entity';
import { KnowledgeIndexJob } from '../entities/knowledge-index-job.entity';
import { KnowledgeBasePurpose } from '../enums/knowledge-base-purpose.enum';
import { KnowledgeDocumentStatus } from '../enums/knowledge-document-status.enum';
import { KnowledgeIndexJobStatus } from '../enums/knowledge-index-job-status.enum';
import { KnowledgeIndexStage } from '../enums/knowledge-index-stage.enum';
import { KnowledgeSourceType } from '../enums/knowledge-source-type.enum';
import {
  KNOWLEDGE_VECTOR_STORE,
} from '../vector-store/knowledge-vector-store.interface';
import type { KnowledgeVectorStore } from '../vector-store/knowledge-vector-store.interface';
import { KnowledgeIngestionService } from './knowledge-ingestion.service';
import { KnowledgeUrlSourceService } from './knowledge-url-source.service';

export type CreateKnowledgeUploadInput = {
  purpose: KnowledgeBasePurpose;
  title?: string;
  metadata?: Record<string, unknown>;
};

export type CreateKnowledgeUrlInput = {
  url: string;
  purpose: KnowledgeBasePurpose;
  title?: string;
  metadata?: Record<string, unknown>;
};

export type CreateKnowledgeTextInput = {
  title: string;
  text: string;
  purpose: KnowledgeBasePurpose;
  metadata?: Record<string, unknown>;
};

export type ListKnowledgeDocumentsInput = {
  purpose?: KnowledgeBasePurpose;
  status?: KnowledgeDocumentStatus;
};

export type UpdateKnowledgeDocumentMetadataInput = {
  title?: string;
  metadata?: Record<string, unknown>;
  tags?: string[];
};

@Injectable()
export class KnowledgeDocumentsService {
  constructor(
    @InjectRepository(KnowledgeDocument)
    private readonly documentRepository: Repository<KnowledgeDocument>,
    @InjectRepository(KnowledgeIndexJob)
    private readonly jobRepository: Repository<KnowledgeIndexJob>,
    @InjectRepository(KnowledgeChunk)
    private readonly chunkRepository: Repository<KnowledgeChunk>,
    private readonly ingestionService: KnowledgeIngestionService,
    private readonly urlSourceService: KnowledgeUrlSourceService,
    @Inject(KNOWLEDGE_VECTOR_STORE)
    private readonly vectorStore: KnowledgeVectorStore,
  ) {}

  async createFromUpload(
    file: Express.Multer.File,
    input: CreateKnowledgeUploadInput,
  ): Promise<{
    documentId: string;
    jobId: string;
    status: KnowledgeDocumentStatus;
  }> {
    const document = await this.documentRepository.save(
      this.documentRepository.create({
        title: input.title?.trim() || file.originalname,
        purpose: input.purpose,
        sourceType: KnowledgeSourceType.UPLOAD,
        originalFileName: file.originalname,
        sourceUrl: null,
        mimeType: file.mimetype,
        size: file.size,
        status: KnowledgeDocumentStatus.PENDING,
        errorCode: null,
        safeErrorMessage: null,
        chunksCount: 0,
        metadata: input.metadata ?? {},
      }),
    );

    const job = await this.jobRepository.save(
      this.jobRepository.create({
        documentId: document.id,
        document,
        status: KnowledgeIndexJobStatus.PENDING,
        stage: KnowledgeIndexStage.PENDING,
        errorCode: null,
        safeErrorMessage: null,
        chunksTotal: 0,
        chunksEmbedded: 0,
        startedAt: null,
        finishedAt: null,
      }),
    );

    this.ingestionService.runAsync(document, job, file);

    return {
      documentId: document.id,
      jobId: job.id,
      status: document.status,
    };
  }

  async createFromUrl(
    input: CreateKnowledgeUrlInput,
  ): Promise<{
    documentId: string;
    jobId: string;
    status: KnowledgeDocumentStatus;
  }> {
    const source = await this.urlSourceService.acquire(input.url);
    const title = input.title?.trim() || source.title || this.titleFromUrl(source.sourceUrl);
    const document = await this.documentRepository.save(
      this.documentRepository.create({
        title,
        purpose: input.purpose,
        sourceType: KnowledgeSourceType.URL,
        originalFileName: this.displayNameFromUrl(source.sourceUrl),
        sourceUrl: source.sourceUrl,
        mimeType: source.mimeType,
        size: source.size,
        status: KnowledgeDocumentStatus.PENDING,
        errorCode: null,
        safeErrorMessage: null,
        chunksCount: 0,
        metadata: input.metadata ?? {},
      }),
    );

    const job = await this.createPendingJob(document);
    this.ingestionService.runExtractedAsync(document, job, {
      blocks: source.blocks,
    });

    return {
      documentId: document.id,
      jobId: job.id,
      status: document.status,
    };
  }

  async createFromText(
    input: CreateKnowledgeTextInput,
  ): Promise<{
    documentId: string;
    jobId: string;
    status: KnowledgeDocumentStatus;
  }> {
    const title = input.title.trim().slice(0, 255) || 'Inline document';
    const document = await this.documentRepository.save(
      this.documentRepository.create({
        title,
        purpose: input.purpose,
        sourceType: KnowledgeSourceType.INLINE,
        originalFileName: title,
        sourceUrl: null,
        mimeType: 'text/plain',
        size: Buffer.byteLength(input.text, 'utf8'),
        status: KnowledgeDocumentStatus.PENDING,
        errorCode: null,
        safeErrorMessage: null,
        chunksCount: 0,
        metadata: input.metadata ?? {},
      }),
    );

    const job = await this.createPendingJob(document);
    this.ingestionService.runExtractedAsync(document, job, {
      blocks: [{ text: input.text, metadata: {} }],
    });

    return {
      documentId: document.id,
      jobId: job.id,
      status: document.status,
    };
  }

  async list(input: ListKnowledgeDocumentsInput): Promise<KnowledgeDocument[]> {
    const where: FindOptionsWhere<KnowledgeDocument> = {};
    if (input.purpose) {
      where.purpose = input.purpose;
    }
    if (input.status) {
      where.status = input.status;
    }

    return this.documentRepository.find({
      where,
      order: { createdAt: 'DESC' },
    });
  }

  async findOne(id: string): Promise<KnowledgeDocument> {
    const document = await this.documentRepository.findOne({ where: { id } });
    if (!document) {
      throw new NotFoundException('Knowledge document not found');
    }
    return document;
  }

  async getChunks(id: string): Promise<KnowledgeChunk[]> {
    await this.findOne(id);
    return this.chunkRepository.find({
      where: { documentId: id },
      order: { chunkIndex: 'ASC' },
    });
  }

  async getJob(id: string): Promise<KnowledgeIndexJob> {
    const job = await this.jobRepository.findOne({ where: { id } });
    if (!job) {
      throw new NotFoundException('Knowledge index job not found');
    }
    return job;
  }

  async updateMetadata(
    id: string,
    input: UpdateKnowledgeDocumentMetadataInput,
  ): Promise<KnowledgeDocument> {
    const document = await this.findOne(id);

    if (input.title !== undefined) {
      document.title = input.title.trim();
    }

    if (input.metadata !== undefined || input.tags !== undefined) {
      document.metadata = {
        ...this.safeMetadata(document.metadata),
        ...(input.metadata ?? {}),
      };

      if (input.tags !== undefined) {
        document.metadata.tags = input.tags;
      }
    }

    return this.documentRepository.save(document);
  }

  async delete(id: string): Promise<void> {
    await this.findOne(id);
    await this.vectorStore.deleteByDocumentId(id);
    await this.documentRepository.delete({ id });
  }

  private safeMetadata(
    metadata: Record<string, unknown> | null | undefined,
  ): Record<string, unknown> {
    return metadata && typeof metadata === 'object' && !Array.isArray(metadata)
      ? metadata
      : {};
  }

  private async createPendingJob(
    document: KnowledgeDocument,
  ): Promise<KnowledgeIndexJob> {
    return this.jobRepository.save(
      this.jobRepository.create({
        documentId: document.id,
        document,
        status: KnowledgeIndexJobStatus.PENDING,
        stage: KnowledgeIndexStage.PENDING,
        errorCode: null,
        safeErrorMessage: null,
        chunksTotal: 0,
        chunksEmbedded: 0,
        startedAt: null,
        finishedAt: null,
      }),
    );
  }

  private titleFromUrl(sourceUrl: string): string {
    return this.displayNameFromUrl(sourceUrl);
  }

  private displayNameFromUrl(sourceUrl: string): string {
    const url = new URL(sourceUrl);
    const displayName = `${url.hostname}${url.pathname}`.replace(/\/$/, '');
    return (displayName || url.hostname).slice(0, 255);
  }
}
