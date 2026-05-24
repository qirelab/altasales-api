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
    const documentRepository = { create: jest.fn(), save: jest.fn(), delete: jest.fn() };
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
  });
});
