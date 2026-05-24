import { KnowledgeBasePurpose } from '../enums/knowledge-base-purpose.enum';
import { KnowledgeDocumentStatus } from '../enums/knowledge-document-status.enum';
import { KnowledgeSourceType } from '../enums/knowledge-source-type.enum';
import { KnowledgeDocumentsService } from './knowledge-documents.service';

describe('KnowledgeDocumentsService', () => {
  it('creates metadata and starts async indexing without storing original file', async () => {
    const documentRepository = {
      create: jest.fn((entity) => entity),
      save: jest.fn(async (entity) => ({ id: 'doc-1', ...entity })),
    };
    const jobRepository = {
      create: jest.fn((entity) => entity),
      save: jest.fn(async (entity) => ({ id: 'job-1', ...entity })),
    };
    const ingestionService = { runAsync: jest.fn() };
    const vectorStore = { deleteByDocumentId: jest.fn() };
    const service = new KnowledgeDocumentsService(
      documentRepository as never,
      jobRepository as never,
      {} as never,
      ingestionService as never,
      vectorStore as never,
    );
    const file = {
      originalname: 'guide.txt',
      mimetype: 'text/plain',
      size: 12,
      buffer: Buffer.from('hello'),
    } as Express.Multer.File;

    const result = await service.createFromUpload(file, {
      purpose: KnowledgeBasePurpose.QA_CHATBOT,
      title: 'Guide',
      metadata: { tags: ['sales'] },
    });

    expect(documentRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Guide',
        purpose: KnowledgeBasePurpose.QA_CHATBOT,
        sourceType: KnowledgeSourceType.UPLOAD,
        originalFileName: 'guide.txt',
        status: KnowledgeDocumentStatus.PENDING,
      }),
    );
    expect(ingestionService.runAsync).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'doc-1' }),
      expect.objectContaining({ id: 'job-1' }),
      expect.objectContaining({ originalname: 'guide.txt' }),
    );
    expect(JSON.stringify(result)).not.toContain('hello');
  });

  it('hard deletes vector points before database document data', async () => {
    const documentRepository = {
      create: jest.fn(),
      save: jest.fn(),
      findOne: jest.fn().mockResolvedValue({ id: 'doc-1', purpose: 'recommendations' }),
      delete: jest.fn(),
    };
    const jobRepository = { create: jest.fn(), save: jest.fn() };
    const vectorStore = { deleteByDocumentId: jest.fn().mockResolvedValue(undefined) };
    const service = new KnowledgeDocumentsService(
      documentRepository as never,
      jobRepository as never,
      {} as never,
      { runAsync: jest.fn() } as never,
      vectorStore as never,
    );

    await service.delete('doc-1');

    expect(vectorStore.deleteByDocumentId).toHaveBeenCalledWith('doc-1');
    expect(documentRepository.delete).toHaveBeenCalledWith({ id: 'doc-1' });
    expect(vectorStore.deleteByDocumentId.mock.invocationCallOrder[0])
      .toBeLessThan(documentRepository.delete.mock.invocationCallOrder[0]);
  });

  it('returns not found when deleting a missing document', async () => {
    const documentRepository = {
      create: jest.fn(),
      save: jest.fn(),
      findOne: jest.fn().mockResolvedValue(null),
      delete: jest.fn(),
    };
    const vectorStore = { deleteByDocumentId: jest.fn() };
    const service = new KnowledgeDocumentsService(
      documentRepository as never,
      { create: jest.fn(), save: jest.fn() } as never,
      {} as never,
      { runAsync: jest.fn() } as never,
      vectorStore as never,
    );

    await expect(service.delete('missing-doc')).rejects.toThrow(
      'Knowledge document not found',
    );

    expect(vectorStore.deleteByDocumentId).not.toHaveBeenCalled();
    expect(documentRepository.delete).not.toHaveBeenCalled();
  });

  it('updates editable metadata fields without touching purpose, chunks, or vectors', async () => {
    const document = {
      id: 'doc-1',
      title: 'Old title',
      purpose: KnowledgeBasePurpose.RECOMMENDATIONS,
      metadata: { tags: ['old'], existing: true },
    };
    const documentRepository = {
      create: jest.fn(),
      save: jest.fn(async (entity) => entity),
      findOne: jest.fn().mockResolvedValue(document),
      delete: jest.fn(),
    };
    const chunkRepository = { find: jest.fn() };
    const vectorStore = { deleteByDocumentId: jest.fn() };
    const service = new KnowledgeDocumentsService(
      documentRepository as never,
      { create: jest.fn(), save: jest.fn() } as never,
      chunkRepository as never,
      { runAsync: jest.fn() } as never,
      vectorStore as never,
    );

    const result = await service.updateMetadata('doc-1', {
      title: 'New title',
      metadata: { source: 'admin' },
      tags: ['fresh', 'sales'],
    });

    expect(result).toEqual(expect.objectContaining({
      title: 'New title',
      purpose: KnowledgeBasePurpose.RECOMMENDATIONS,
      metadata: {
        existing: true,
        source: 'admin',
        tags: ['fresh', 'sales'],
      },
    }));
    expect(chunkRepository.find).not.toHaveBeenCalled();
    expect(vectorStore.deleteByDocumentId).not.toHaveBeenCalled();
  });

  it('preserves existing tags when metadata is merged without tags', async () => {
    const documentRepository = {
      create: jest.fn(),
      save: jest.fn(async (entity) => entity),
      findOne: jest.fn().mockResolvedValue({
        id: 'doc-1',
        metadata: { tags: ['keep'], owner: 'kb' },
      }),
      delete: jest.fn(),
    };
    const service = new KnowledgeDocumentsService(
      documentRepository as never,
      { create: jest.fn(), save: jest.fn() } as never,
      {} as never,
      { runAsync: jest.fn() } as never,
      { deleteByDocumentId: jest.fn() } as never,
    );

    const result = await service.updateMetadata('doc-1', {
      metadata: { reviewed: true },
    });

    expect(result.metadata).toEqual({
      tags: ['keep'],
      owner: 'kb',
      reviewed: true,
    });
  });

  it('returns not found when updating a missing document', async () => {
    const documentRepository = {
      create: jest.fn(),
      save: jest.fn(),
      findOne: jest.fn().mockResolvedValue(null),
      delete: jest.fn(),
    };
    const service = new KnowledgeDocumentsService(
      documentRepository as never,
      { create: jest.fn(), save: jest.fn() } as never,
      {} as never,
      { runAsync: jest.fn() } as never,
      { deleteByDocumentId: jest.fn() } as never,
    );

    await expect(
      service.updateMetadata('missing-doc', { title: 'New title' }),
    ).rejects.toThrow('Knowledge document not found');
    expect(documentRepository.save).not.toHaveBeenCalled();
  });
});
