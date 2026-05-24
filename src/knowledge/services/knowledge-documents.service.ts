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

export type CreateKnowledgeUploadInput = {
  purpose: KnowledgeBasePurpose;
  title?: string;
  metadata?: Record<string, unknown>;
};

export type ListKnowledgeDocumentsInput = {
  purpose?: KnowledgeBasePurpose;
  status?: KnowledgeDocumentStatus;
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

  async delete(id: string): Promise<void> {
    await this.vectorStore.deleteByDocumentId(id);
    await this.documentRepository.delete({ id });
  }
}
