import {
  ArgumentMetadata,
  BadRequestException,
  NotFoundException,
  ValidationPipe,
} from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Test } from '@nestjs/testing';
import { ROLES_KEY } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { SessionGuard } from '../auth/guards/session.guard';
import { UserRole } from '../users/entities/user-role.enum';
import { CreateKnowledgeUrlDocumentDto } from './dto/create-knowledge-url-document.dto';
import { ListKnowledgeDocumentsDto } from './dto/list-knowledge-documents.dto';
import { SearchKnowledgeDto } from './dto/search-knowledge.dto';
import { UpdateKnowledgeDocumentDto } from './dto/update-knowledge-document.dto';
import { UploadKnowledgeDocumentDto } from './dto/upload-knowledge-document.dto';
import { KnowledgeBasePurpose } from './enums/knowledge-base-purpose.enum';
import { KnowledgeDocumentStatus } from './enums/knowledge-document-status.enum';
import {
  isSupportedKnowledgeUploadFile,
  KnowledgeController,
} from './knowledge.controller';
import { KnowledgeDocumentsService } from './services/knowledge-documents.service';
import { KnowledgeSearchService } from './services/knowledge-search.service';

const DOCUMENT_ID = '00000000-0000-4000-8000-000000000001';
const JOB_ID = '00000000-0000-4000-8000-000000000002';

type DocumentsServiceMock = {
  createFromUpload: jest.Mock;
  createFromUrl: jest.Mock;
  list: jest.Mock;
  findOne: jest.Mock;
  getChunks: jest.Mock;
  getJob: jest.Mock;
  delete: jest.Mock;
  updateMetadata: jest.Mock;
};

describe('KnowledgeController API contract', () => {
  let controller: KnowledgeController;
  let documentsService: DocumentsServiceMock;
  let searchService: { search: jest.Mock };

  beforeEach(async () => {
    documentsService = {
      createFromUpload: jest.fn().mockResolvedValue({
        documentId: DOCUMENT_ID,
        jobId: JOB_ID,
        status: KnowledgeDocumentStatus.PENDING,
      }),
      createFromUrl: jest.fn().mockResolvedValue({
        documentId: DOCUMENT_ID,
        jobId: JOB_ID,
        status: KnowledgeDocumentStatus.PENDING,
      }),
      list: jest.fn().mockResolvedValue([
        {
          id: DOCUMENT_ID,
          title: 'Guide',
          purpose: KnowledgeBasePurpose.RECOMMENDATIONS,
          metadata: { tags: ['sales'] },
        },
      ]),
      findOne: jest.fn().mockResolvedValue({
        id: DOCUMENT_ID,
        title: 'Guide',
        purpose: KnowledgeBasePurpose.RECOMMENDATIONS,
        metadata: {},
      }),
      getChunks: jest.fn().mockResolvedValue([
        {
          id: 'chunk-1',
          documentId: DOCUMENT_ID,
          chunkIndex: 0,
          text: 'Admin-visible chunk',
          metadata: {},
        },
      ]),
      getJob: jest.fn().mockResolvedValue({ id: JOB_ID, documentId: DOCUMENT_ID }),
      delete: jest.fn().mockResolvedValue(undefined),
      updateMetadata: jest.fn().mockImplementation(async (_id, dto) => ({
        id: DOCUMENT_ID,
        purpose: KnowledgeBasePurpose.RECOMMENDATIONS,
        ...dto,
      })),
    };
    searchService = {
      search: jest.fn().mockResolvedValue({
        results: [
          {
            chunkId: 'chunk-1',
            documentId: DOCUMENT_ID,
            text: 'Relevant chunk',
            score: 0.92,
            chunkIndex: 0,
            metadata: {},
            document: {
              id: DOCUMENT_ID,
              title: 'Guide',
              purpose: KnowledgeBasePurpose.RECOMMENDATIONS,
              mimeType: 'text/plain',
              originalFileName: 'guide.txt',
            },
          },
        ],
      }),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [KnowledgeController],
      providers: [
        {
          provide: KnowledgeDocumentsService,
          useValue: documentsService,
        },
        {
          provide: KnowledgeSearchService,
          useValue: searchService,
        },
      ],
    })
      .overrideGuard(SessionGuard)
      .useValue({ canActivate: jest.fn(() => true) })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: jest.fn(() => true) })
      .compile();

    controller = moduleRef.get(KnowledgeController);
  });

  it('declares admin-only guards at controller level', () => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, KnowledgeController);
    const roles = Reflect.getMetadata(ROLES_KEY, KnowledgeController);

    expect(guards).toEqual([SessionGuard, RolesGuard]);
    expect(roles).toEqual([UserRole.ADMIN]);
  });

  it('uploads a supported document and maps metadata fields to the service', async () => {
    const dto = await validateBody(UploadKnowledgeDocumentDto, {
      purpose: KnowledgeBasePurpose.RECOMMENDATIONS,
      title: 'Guide',
      metadata: '{"department":"sales"}',
      tags: 'alpha, beta',
    });

    const result = await controller.upload(
      file('guide.txt', 'text/plain', 'hello'),
      dto,
    );

    expect(result).toEqual({
      documentId: DOCUMENT_ID,
      jobId: JOB_ID,
      status: KnowledgeDocumentStatus.PENDING,
    });
    expect(documentsService.createFromUpload).toHaveBeenCalledWith(
      expect.objectContaining({
        originalname: 'guide.txt',
        mimetype: 'text/plain',
      }),
      {
        purpose: KnowledgeBasePurpose.RECOMMENDATIONS,
        title: 'Guide',
        metadata: {
          department: 'sales',
          tags: ['alpha', 'beta'],
        },
      },
    );
  });

  it('rejects upload with invalid purpose', async () => {
    await expect(
      validateBody(UploadKnowledgeDocumentDto, { purpose: 'invalid' }),
    ).rejects.toThrow(BadRequestException);
    expect(documentsService.createFromUpload).not.toHaveBeenCalled();
  });

  it('rejects upload without a file', async () => {
    const dto = await validateBody(UploadKnowledgeDocumentDto, {
      purpose: KnowledgeBasePurpose.RECOMMENDATIONS,
    });

    await expect(controller.upload(undefined as never, dto)).rejects.toThrow(
      'File is required',
    );
    expect(documentsService.createFromUpload).not.toHaveBeenCalled();
  });

  it('rejects unsupported upload MIME types', () => {
    expect(
      isSupportedKnowledgeUploadFile({
        originalname: 'deck.pptx',
        mimetype:
          'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      }),
    ).toBe(false);
  });

  it('creates a URL document and maps safe metadata fields to the service', async () => {
    const dto = await validateBody(CreateKnowledgeUrlDocumentDto, {
      url: 'https://example.com/page',
      purpose: KnowledgeBasePurpose.RECOMMENDATIONS,
      title: 'Page title',
      metadata: { department: 'sales' },
      tags: [' alpha ', 'beta', 'alpha'],
    });

    const result = await controller.createFromUrl(dto);

    expect(result).toEqual({
      documentId: DOCUMENT_ID,
      jobId: JOB_ID,
      status: KnowledgeDocumentStatus.PENDING,
    });
    expect(documentsService.createFromUrl).toHaveBeenCalledWith({
      url: 'https://example.com/page',
      purpose: KnowledgeBasePurpose.RECOMMENDATIONS,
      title: 'Page title',
      metadata: {
        department: 'sales',
        tags: ['alpha', 'beta'],
      },
    });
  });

  it('rejects invalid URL document bodies', async () => {
    await expect(
      validateBody(CreateKnowledgeUrlDocumentDto, {
        url: 'ftp://example.com/file',
        purpose: KnowledgeBasePurpose.RECOMMENDATIONS,
      }),
    ).rejects.toThrow(BadRequestException);

    await expect(
      validateBody(CreateKnowledgeUrlDocumentDto, {
        url: 'https://example.com/page',
        purpose: KnowledgeBasePurpose.RECOMMENDATIONS,
        unexpected: true,
      }),
    ).rejects.toThrow(BadRequestException);

    expect(documentsService.createFromUrl).not.toHaveBeenCalled();
  });

  it('passes list filters to the service', async () => {
    const query = await validateQuery(ListKnowledgeDocumentsDto, {
      purpose: KnowledgeBasePurpose.RECOMMENDATIONS,
      status: KnowledgeDocumentStatus.INDEXED,
    });

    await controller.list(query);

    expect(documentsService.list).toHaveBeenCalledWith({
      purpose: KnowledgeBasePurpose.RECOMMENDATIONS,
      status: KnowledgeDocumentStatus.INDEXED,
    });
  });

  it('maps get document not found errors', async () => {
    documentsService.findOne.mockRejectedValueOnce(
      new NotFoundException('Knowledge document not found'),
    );

    await expect(controller.getDocument(DOCUMENT_ID)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('returns chunks without vectors', async () => {
    const result = await controller.getChunks(DOCUMENT_ID);

    expect(documentsService.getChunks).toHaveBeenCalledWith(DOCUMENT_ID);
    expect(JSON.stringify(result)).not.toContain('vector');
  });

  it('rejects empty search query and missing purpose', async () => {
    await expect(
      validateBody(SearchKnowledgeDto, {
        purpose: KnowledgeBasePurpose.RECOMMENDATIONS,
        query: '',
      }),
    ).rejects.toThrow(BadRequestException);

    await expect(
      validateBody(SearchKnowledgeDto, { query: 'pricing' }),
    ).rejects.toThrow(BadRequestException);

    expect(searchService.search).not.toHaveBeenCalled();
  });

  it('searches through the service without returning vectors', async () => {
    const dto = await validateBody(SearchKnowledgeDto, {
      purpose: KnowledgeBasePurpose.RECOMMENDATIONS,
      query: 'pricing',
      limit: 3,
    });

    const result = await controller.search(dto);

    expect(searchService.search).toHaveBeenCalledWith({
      purpose: KnowledgeBasePurpose.RECOMMENDATIONS,
      query: 'pricing',
      limit: 3,
    });
    expect(JSON.stringify(result)).not.toContain('vector');
  });

  it('deletes documents through the service and maps not found errors', async () => {
    await expect(controller.delete(DOCUMENT_ID)).resolves.toEqual({ success: true });
    expect(documentsService.delete).toHaveBeenCalledWith(DOCUMENT_ID);

    documentsService.delete.mockRejectedValueOnce(
      new NotFoundException('Knowledge document not found'),
    );
    await expect(controller.delete(DOCUMENT_ID)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('updates document title metadata through PATCH', async () => {
    const dto = await validateBody(UpdateKnowledgeDocumentDto, {
      title: '  New title  ',
    });

    await controller.updateDocument(DOCUMENT_ID, dto);

    expect(documentsService.updateMetadata).toHaveBeenCalledWith(DOCUMENT_ID, {
      title: 'New title',
    });
  });

  it('updates document metadata through PATCH', async () => {
    const dto = await validateBody(UpdateKnowledgeDocumentDto, {
      metadata: { source: 'admin' },
    });

    await controller.updateDocument(DOCUMENT_ID, dto);

    expect(documentsService.updateMetadata).toHaveBeenCalledWith(DOCUMENT_ID, {
      metadata: { source: 'admin' },
    });
  });

  it('updates normalized tags through PATCH', async () => {
    const dto = await validateBody(UpdateKnowledgeDocumentDto, {
      tags: [' sales ', 'support', 'sales'],
    });

    await controller.updateDocument(DOCUMENT_ID, dto);

    expect(documentsService.updateMetadata).toHaveBeenCalledWith(DOCUMENT_ID, {
      tags: ['sales', 'support'],
    });
  });

  it('rejects unsupported document update fields', async () => {
    await expect(
      validateBody(UpdateKnowledgeDocumentDto, {
        purpose: KnowledgeBasePurpose.QA_CHATBOT,
      }),
    ).rejects.toThrow(BadRequestException);

    expect(documentsService.updateMetadata).not.toHaveBeenCalled();
  });

  it('rejects empty document update bodies', async () => {
    const dto = await validateBody(UpdateKnowledgeDocumentDto, {});

    await expect(controller.updateDocument(DOCUMENT_ID, dto)).rejects.toThrow(
      'At least one knowledge document metadata field is required',
    );
    expect(documentsService.updateMetadata).not.toHaveBeenCalled();
  });

  it('rejects invalid document update metadata and tags', async () => {
    await expect(
      validateBody(UpdateKnowledgeDocumentDto, { metadata: ['not-object'] }),
    ).rejects.toThrow(BadRequestException);

    await expect(
      validateBody(UpdateKnowledgeDocumentDto, { metadata: null }),
    ).rejects.toThrow(BadRequestException);

    await expect(
      validateBody(UpdateKnowledgeDocumentDto, { metadata: 'not-object' }),
    ).rejects.toThrow(BadRequestException);

    await expect(
      validateBody(UpdateKnowledgeDocumentDto, { tags: ['valid', '   '] }),
    ).rejects.toThrow(BadRequestException);

    expect(documentsService.updateMetadata).not.toHaveBeenCalled();
  });

  it('maps PATCH not found errors', async () => {
    documentsService.updateMetadata.mockRejectedValueOnce(
      new NotFoundException('Knowledge document not found'),
    );
    const dto = await validateBody(UpdateKnowledgeDocumentDto, {
      title: 'New title',
    });

    await expect(controller.updateDocument(DOCUMENT_ID, dto)).rejects.toThrow(
      NotFoundException,
    );
  });
});

async function validateBody<T extends object>(
  metatype: new () => T,
  value: Record<string, unknown>,
): Promise<T> {
  return validate(metatype, value, { type: 'body', metatype });
}

async function validateQuery<T extends object>(
  metatype: new () => T,
  value: Record<string, unknown>,
): Promise<T> {
  return validate(metatype, value, { type: 'query', metatype });
}

async function validate<T extends object>(
  metatype: new () => T,
  value: Record<string, unknown>,
  metadata: ArgumentMetadata,
): Promise<T> {
  const pipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  });

  return pipe.transform(value, metadata) as Promise<T>;
}

function file(
  originalname: string,
  mimetype: string,
  content: string,
): Express.Multer.File {
  const buffer = Buffer.from(content, 'utf8');
  return {
    originalname,
    mimetype,
    size: buffer.length,
    buffer,
  } as Express.Multer.File;
}
