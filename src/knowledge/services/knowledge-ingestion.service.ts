import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EmbeddingProxyService } from '../../ai/embedding-proxy.service';
import { DataClass } from '../../ai/enums/data-class.enum';
import { KnowledgeChunk } from '../entities/knowledge-chunk.entity';
import { KnowledgeDocument } from '../entities/knowledge-document.entity';
import { KnowledgeIndexJob } from '../entities/knowledge-index-job.entity';
import { KnowledgeDocumentStatus } from '../enums/knowledge-document-status.enum';
import { KnowledgeIndexJobStatus } from '../enums/knowledge-index-job-status.enum';
import { KnowledgeIndexStage } from '../enums/knowledge-index-stage.enum';
import {
  KNOWLEDGE_VECTOR_STORE,
} from '../vector-store/knowledge-vector-store.interface';
import type { KnowledgeVectorStore } from '../vector-store/knowledge-vector-store.interface';
import { KnowledgeChunkingService } from './knowledge-chunking.service';
import { KnowledgeExtractionService } from './knowledge-extraction.service';

const DEFAULT_EMBEDDING_BATCH_SIZE = 32;

@Injectable()
export class KnowledgeIngestionService {
  private readonly logger = new Logger(KnowledgeIngestionService.name);

  constructor(
    @InjectRepository(KnowledgeDocument)
    private readonly documentRepository: Repository<KnowledgeDocument>,
    @InjectRepository(KnowledgeChunk)
    private readonly chunkRepository: Repository<KnowledgeChunk>,
    @InjectRepository(KnowledgeIndexJob)
    private readonly jobRepository: Repository<KnowledgeIndexJob>,
    private readonly extractionService: KnowledgeExtractionService,
    private readonly chunkingService: KnowledgeChunkingService,
    private readonly embeddingProxy: EmbeddingProxyService,
    @Inject(KNOWLEDGE_VECTOR_STORE)
    private readonly vectorStore: KnowledgeVectorStore,
  ) {}

  runAsync(
    document: KnowledgeDocument,
    job: KnowledgeIndexJob,
    file: Express.Multer.File,
  ): void {
    this.run(document, job, file).catch(() => undefined);
  }

  async run(
    document: KnowledgeDocument,
    job: KnowledgeIndexJob,
    file: Express.Multer.File,
  ): Promise<void> {
    const startedAt = Date.now();

    try {
      job.startedAt = new Date();
      await this.setStage(document, job, KnowledgeIndexStage.EXTRACTING);
      const extraction = await this.extractionService.extract(file);

      await this.setStage(document, job, KnowledgeIndexStage.CHUNKING);
      const preparedChunks = this.chunkingService.chunk(extraction.blocks);
      job.chunksTotal = preparedChunks.length;
      document.chunksCount = preparedChunks.length;

      const chunks = await this.chunkRepository.save(
        preparedChunks.map((chunk) =>
          this.chunkRepository.create({
            documentId: document.id,
            chunkIndex: chunk.chunkIndex,
            text: chunk.text,
            charLength: chunk.charLength,
            tokenEstimate: chunk.tokenEstimate,
            metadata: chunk.metadata,
          }),
        ),
      );

      await this.setStage(document, job, KnowledgeIndexStage.EMBEDDING);
      const embeddings = await this.embedChunks(chunks, job);

      await this.setStage(document, job, KnowledgeIndexStage.INDEXING);
      await this.vectorStore.ensureCollection();
      await this.vectorStore.upsertChunks(document, chunks, embeddings);

      document.status = KnowledgeDocumentStatus.INDEXED;
      document.errorCode = null;
      document.safeErrorMessage = null;
      job.status = KnowledgeIndexJobStatus.SUCCEEDED;
      job.stage = KnowledgeIndexStage.INDEXED;
      job.finishedAt = new Date();
      await this.documentRepository.save(document);
      await this.jobRepository.save(job);

      this.logger.log({
        eventName: 'KNOWLEDGE_INDEX_SUCCEEDED',
        documentId: document.id,
        jobId: job.id,
        purpose: document.purpose,
        status: document.status,
        chunksCount: chunks.length,
        latencyMs: Date.now() - startedAt,
      });
    } catch (error) {
      await this.vectorStore.deleteByDocumentId(document.id).catch(() => undefined);
      const errorCode = this.getSafeErrorCode(error);
      document.status = KnowledgeDocumentStatus.FAILED;
      document.errorCode = errorCode;
      document.safeErrorMessage = 'Knowledge indexing failed';
      job.status = KnowledgeIndexJobStatus.FAILED;
      job.stage = KnowledgeIndexStage.FAILED;
      job.errorCode = errorCode;
      job.safeErrorMessage = 'Knowledge indexing failed';
      job.finishedAt = new Date();
      await this.documentRepository.save(document);
      await this.jobRepository.save(job);
      this.logger.error({
        eventName: 'KNOWLEDGE_INDEX_FAILED',
        documentId: document.id,
        jobId: job.id,
        purpose: document.purpose,
        status: document.status,
        stage: job.stage,
        errorCode,
        latencyMs: Date.now() - startedAt,
      });
    }
  }

  private async embedChunks(
    chunks: KnowledgeChunk[],
    job: KnowledgeIndexJob,
  ): Promise<number[][]> {
    const batchSize = this.getPositiveInteger(
      process.env.KNOWLEDGE_EMBEDDING_BATCH_SIZE,
      DEFAULT_EMBEDDING_BATCH_SIZE,
    );
    const embeddings: number[][] = [];

    for (let index = 0; index < chunks.length; index += batchSize) {
      const batch = chunks.slice(index, index + batchSize);
      const response = await this.embeddingProxy.embed({
        inputs: batch.map((chunk) => chunk.text),
        declaredDataClass: DataClass.RawPii,
      });
      embeddings.push(...response.vectors);
      job.chunksEmbedded = embeddings.length;
      await this.jobRepository.save(job);
    }

    return embeddings;
  }

  private async setStage(
    document: KnowledgeDocument,
    job: KnowledgeIndexJob,
    stage: KnowledgeIndexStage,
  ): Promise<void> {
    document.status = this.documentStatusForStage(stage);
    job.status = KnowledgeIndexJobStatus.RUNNING;
    job.stage = stage;
    await this.documentRepository.save(document);
    await this.jobRepository.save(job);
  }

  private documentStatusForStage(
    stage: KnowledgeIndexStage,
  ): KnowledgeDocumentStatus {
    switch (stage) {
      case KnowledgeIndexStage.EXTRACTING:
        return KnowledgeDocumentStatus.EXTRACTING;
      case KnowledgeIndexStage.CHUNKING:
        return KnowledgeDocumentStatus.CHUNKING;
      case KnowledgeIndexStage.EMBEDDING:
        return KnowledgeDocumentStatus.EMBEDDING;
      case KnowledgeIndexStage.INDEXING:
        return KnowledgeDocumentStatus.INDEXING;
      case KnowledgeIndexStage.INDEXED:
        return KnowledgeDocumentStatus.INDEXED;
      case KnowledgeIndexStage.FAILED:
        return KnowledgeDocumentStatus.FAILED;
      case KnowledgeIndexStage.PENDING:
      default:
        return KnowledgeDocumentStatus.PENDING;
    }
  }

  private getSafeErrorCode(error: unknown): string {
    if (error && typeof error === 'object') {
      const safeErrorCode = (error as { safeErrorCode?: unknown }).safeErrorCode;
      if (typeof safeErrorCode === 'string') {
        return safeErrorCode;
      }

      const response = (error as { response?: { message?: unknown } }).response;
      if (typeof response?.message === 'string') {
        return response.message;
      }
    }

    return 'KNOWLEDGE_INDEX_FAILED';
  }

  private getPositiveInteger(value: string | undefined, fallback: number): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  }
}
