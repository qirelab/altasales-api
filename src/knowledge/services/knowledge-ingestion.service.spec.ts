import { Logger } from '@nestjs/common';
import { DataClass } from '../../ai/enums/data-class.enum';
import { KnowledgeBasePurpose } from '../enums/knowledge-base-purpose.enum';
import { KnowledgeDocumentStatus } from '../enums/knowledge-document-status.enum';
import { KnowledgeIndexJobStatus } from '../enums/knowledge-index-job-status.enum';
import { KnowledgeIndexStage } from '../enums/knowledge-index-stage.enum';
import { KnowledgeDocument } from '../entities/knowledge-document.entity';
import { KnowledgeIndexJob } from '../entities/knowledge-index-job.entity';
import { KnowledgeIngestionService } from './knowledge-ingestion.service';

describe('KnowledgeIngestionService', () => {
  let service: KnowledgeIngestionService;
  let documentRepository: { save: jest.Mock };
  let chunkRepository: { create: jest.Mock; save: jest.Mock };
  let jobRepository: { save: jest.Mock };
  let extractionService: { extract: jest.Mock };
  let chunkingService: { chunk: jest.Mock };
  let embeddingProxy: { embed: jest.Mock };
  let vectorStore: { ensureCollection: jest.Mock; upsertChunks: jest.Mock; deleteByDocumentId: jest.Mock };
  let loggerLogSpy: jest.SpyInstance;
  let loggerErrorSpy: jest.SpyInstance;
  let document: KnowledgeDocument;
  let job: KnowledgeIndexJob;

  beforeEach(() => {
    documentRepository = { save: jest.fn(async (entity) => entity) };
    chunkRepository = {
      create: jest.fn((entity) => entity),
      save: jest.fn(async (entities) =>
        entities.map((entity: Record<string, unknown>, index: number) => ({
          id: `chunk-${index + 1}`,
          ...entity,
        })),
      ),
    };
    jobRepository = { save: jest.fn(async (entity) => entity) };
    extractionService = {
      extract: jest.fn().mockResolvedValue({
        blocks: [{ text: 'first chunk\n\nsecond chunk', metadata: { pageNumber: 1 } }],
      }),
    };
    chunkingService = {
      chunk: jest.fn().mockReturnValue([
        {
          chunkIndex: 0,
          text: 'first chunk',
          charLength: 11,
          tokenEstimate: 3,
          metadata: { pageNumber: 1 },
        },
        {
          chunkIndex: 1,
          text: 'second chunk',
          charLength: 12,
          tokenEstimate: 3,
          metadata: { pageNumber: 1 },
        },
      ]),
    };
    embeddingProxy = {
      embed: jest.fn().mockResolvedValue({
        vectors: [[0.1, 0.2], [0.3, 0.4]],
        dimensions: 2,
      }),
    };
    vectorStore = {
      ensureCollection: jest.fn().mockResolvedValue(undefined),
      upsertChunks: jest.fn().mockResolvedValue(undefined),
      deleteByDocumentId: jest.fn().mockResolvedValue(undefined),
    };
    loggerLogSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    loggerErrorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    service = new KnowledgeIngestionService(
      documentRepository as never,
      chunkRepository as never,
      jobRepository as never,
      extractionService as never,
      chunkingService as never,
      embeddingProxy as never,
      vectorStore as never,
    );
    document = {
      id: 'document-1',
      purpose: KnowledgeBasePurpose.RECOMMENDATIONS,
      mimeType: 'text/plain',
      originalFileName: 'guide.txt',
    } as KnowledgeDocument;
    job = {
      id: 'job-1',
      document,
      documentId: document.id,
    } as KnowledgeIndexJob;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('indexes chunks through EmbeddingProxyService and vector store', async () => {
    await service.run(document, job, file('guide.txt', 'text/plain', 'content'));

    expect(embeddingProxy.embed).toHaveBeenCalledWith({
      inputs: ['first chunk', 'second chunk'],
      declaredDataClass: DataClass.RawPii,
    });
    expect(vectorStore.ensureCollection).toHaveBeenCalledTimes(1);
    expect(vectorStore.upsertChunks).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'document-1' }),
      expect.arrayContaining([
        expect.objectContaining({ id: 'chunk-1', text: 'first chunk' }),
      ]),
      [[0.1, 0.2], [0.3, 0.4]],
    );
    expect(document.status).toBe(KnowledgeDocumentStatus.INDEXED);
    expect(document.chunksCount).toBe(2);
    expect(job.status).toBe(KnowledgeIndexJobStatus.SUCCEEDED);
    expect(job.stage).toBe(KnowledgeIndexStage.INDEXED);
  });

  it('indexes already extracted URL blocks through the same embedding and vector path', async () => {
    await service.runExtracted(document, job, {
      blocks: [{ text: 'url extracted text', metadata: { sourceFormat: 'html' } }],
    });

    expect(extractionService.extract).not.toHaveBeenCalled();
    expect(chunkingService.chunk).toHaveBeenCalledWith([
      { text: 'url extracted text', metadata: { sourceFormat: 'html' } },
    ]);
    expect(embeddingProxy.embed).toHaveBeenCalledWith({
      inputs: ['first chunk', 'second chunk'],
      declaredDataClass: DataClass.RawPii,
    });
    expect(vectorStore.upsertChunks).toHaveBeenCalled();
    expect(document.status).toBe(KnowledgeDocumentStatus.INDEXED);
    expect(job.status).toBe(KnowledgeIndexJobStatus.SUCCEEDED);
  });

  it('fails closed with safe metadata and cleans partial vector data', async () => {
    extractionService.extract.mockResolvedValueOnce({
      blocks: [{ text: 'secret raw text', metadata: {} }],
    });
    chunkingService.chunk.mockReturnValueOnce([
      {
        chunkIndex: 0,
        text: 'secret raw text',
        charLength: 15,
        tokenEstimate: 4,
        metadata: {},
      },
    ]);
    embeddingProxy.embed.mockRejectedValueOnce(
      Object.assign(new Error('provider exploded secret raw text'), {
        safeErrorCode: 'AI_EMBEDDING_PROVIDER_UNAVAILABLE',
      }),
    );

    await service.run(document, job, file('guide.txt', 'text/plain', 'secret raw text'));

    expect(vectorStore.deleteByDocumentId).toHaveBeenCalledWith('document-1');
    expect(document.status).toBe(KnowledgeDocumentStatus.FAILED);
    expect(document.errorCode).toBe('AI_EMBEDDING_PROVIDER_UNAVAILABLE');
    expect(job.status).toBe(KnowledgeIndexJobStatus.FAILED);
    const serializedLogs = [...loggerLogSpy.mock.calls, ...loggerErrorSpy.mock.calls]
      .flat()
      .map((entry) => JSON.stringify(entry))
      .join(' ');
    expect(serializedLogs).toContain('document-1');
    expect(serializedLogs).toContain('job-1');
    expect(serializedLogs).not.toContain('secret raw text');
    expect(serializedLogs).not.toContain('0.1');
  });

  function file(
    originalname: string,
    mimetype: string,
    content: string,
  ): Express.Multer.File {
    const buffer = Buffer.from(content, 'utf8');
    return { originalname, mimetype, size: buffer.length, buffer } as Express.Multer.File;
  }
});
