import { extname } from 'path';
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';
import {
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { SessionGuard } from '../auth/guards/session.guard';
import { UserRole } from '../users/entities/user-role.enum';
import { CreateKnowledgeUrlDocumentDto } from './dto/create-knowledge-url-document.dto';
import { ListKnowledgeDocumentsDto } from './dto/list-knowledge-documents.dto';
import { SearchKnowledgeDto } from './dto/search-knowledge.dto';
import { UpdateKnowledgeDocumentDto } from './dto/update-knowledge-document.dto';
import { UploadKnowledgeDocumentDto } from './dto/upload-knowledge-document.dto';
import { KnowledgeDocumentsService } from './services/knowledge-documents.service';
import { KnowledgeSearchService } from './services/knowledge-search.service';

type UploadFileMetadata = {
  originalname: string;
  mimetype: string;
};

const DEFAULT_MAX_FILE_SIZE_MB = 100;
const SUPPORTED_UPLOAD_TYPES = new Map([
  ['application/pdf', new Set(['.pdf'])],
  [
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    new Set(['.docx']),
  ],
  [
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    new Set(['.xlsx']),
  ],
  ['text/plain', new Set(['.txt', '.md', '.markdown'])],
  ['text/csv', new Set(['.csv'])],
  ['text/markdown', new Set(['.md', '.markdown'])],
  ['application/json', new Set(['.json'])],
  ['image/png', new Set(['.png'])],
  ['image/jpeg', new Set(['.jpg', '.jpeg'])],
]);

function getMaxFileSizeBytes(): number {
  const parsed = Number(process.env.KNOWLEDGE_MAX_FILE_SIZE_MB);
  const sizeMb = Number.isFinite(parsed) && parsed > 0
    ? parsed
    : DEFAULT_MAX_FILE_SIZE_MB;
  return sizeMb * 1024 * 1024;
}

export function isSupportedKnowledgeUploadFile(file: UploadFileMetadata): boolean {
  const extension = extname(file.originalname).toLowerCase();
  return SUPPORTED_UPLOAD_TYPES.get(file.mimetype)?.has(extension) ?? false;
}

const uploadOptions = {
  limits: { fileSize: getMaxFileSizeBytes() },
  fileFilter: (_req, file, cb) => {
    if (isSupportedKnowledgeUploadFile(file)) {
      cb(null, true);
      return;
    }

    cb(new BadRequestException('Unsupported knowledge document type'), false);
  },
} satisfies MulterOptions;

@ApiTags('knowledge')
@Controller('knowledge')
@UseGuards(SessionGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class KnowledgeController {
  constructor(
    private readonly documentsService: KnowledgeDocumentsService,
    private readonly searchService: KnowledgeSearchService,
  ) {}

  @Post('documents/upload')
  @ApiOperation({ summary: 'Upload and index a knowledge document' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file', 'purpose'],
      properties: {
        file: { type: 'string', format: 'binary' },
        purpose: { type: 'string' },
        title: { type: 'string' },
        metadata: { type: 'string' },
        tags: { type: 'string' },
      },
    },
  })
  @ApiResponse({ status: 201, description: 'Knowledge indexing started' })
  @UseInterceptors(FileInterceptor('file', uploadOptions))
  async upload(
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: UploadKnowledgeDocumentDto,
  ) {
    if (!file) {
      throw new BadRequestException('File is required');
    }

    return this.documentsService.createFromUpload(file, {
      purpose: dto.purpose,
      title: dto.title,
      metadata: this.parseMetadata(dto.metadata, dto.tags),
    });
  }

  @Post('documents/url')
  @ApiOperation({ summary: 'Fetch and index a single knowledge URL' })
  @ApiResponse({ status: 201, description: 'Knowledge URL indexing started' })
  async createFromUrl(@Body() dto: CreateKnowledgeUrlDocumentDto) {
    return this.documentsService.createFromUrl({
      url: dto.url,
      purpose: dto.purpose,
      title: dto.title,
      metadata: this.mergeObjectMetadata(dto.metadata, dto.tags),
    });
  }

  @Get('documents')
  @ApiOperation({ summary: 'List knowledge documents' })
  @ApiQuery({ name: 'purpose', required: false })
  @ApiQuery({ name: 'status', required: false })
  async list(@Query() query: ListKnowledgeDocumentsDto) {
    return this.documentsService.list(query);
  }

  @Get('documents/:id')
  @ApiOperation({ summary: 'Get knowledge document metadata' })
  async getDocument(@Param('id', ParseUUIDPipe) id: string) {
    return this.documentsService.findOne(id);
  }

  @Patch('documents/:id')
  @ApiOperation({ summary: 'Update knowledge document metadata' })
  async updateDocument(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateKnowledgeDocumentDto,
  ) {
    if (!this.hasUpdateFields(dto)) {
      throw new BadRequestException(
        'At least one knowledge document metadata field is required',
      );
    }

    return this.documentsService.updateMetadata(id, dto);
  }

  @Get('documents/:id/chunks')
  @ApiOperation({ summary: 'Get knowledge document chunks for admin/debug' })
  async getChunks(@Param('id', ParseUUIDPipe) id: string) {
    return this.documentsService.getChunks(id);
  }

  @Get('index-jobs/:id')
  @ApiOperation({ summary: 'Get knowledge indexing job status' })
  async getJob(@Param('id', ParseUUIDPipe) id: string) {
    return this.documentsService.getJob(id);
  }

  @Post('search')
  @ApiOperation({ summary: 'Search knowledge chunks for admin/debug' })
  async search(@Body() dto: SearchKnowledgeDto) {
    return this.searchService.search(dto);
  }

  @Delete('documents/:id')
  @ApiOperation({ summary: 'Hard delete knowledge document data' })
  async delete(@Param('id', ParseUUIDPipe) id: string) {
    await this.documentsService.delete(id);
    return { success: true };
  }

  private parseMetadata(
    metadata?: string,
    tags?: string,
  ): Record<string, unknown> {
    const parsedMetadata = metadata ? this.parseMetadataJson(metadata) : {};
    const parsedTags = tags
      ?.split(',')
      .map((tag) => tag.trim())
      .filter(Boolean);

    if (parsedTags?.length) {
      parsedMetadata.tags = parsedTags;
    }

    return parsedMetadata;
  }

  private parseMetadataJson(metadata: string): Record<string, unknown> {
    try {
      const parsed = JSON.parse(metadata);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('metadata_not_object');
      }
      return parsed as Record<string, unknown>;
    } catch {
      throw new BadRequestException('Knowledge metadata must be a JSON object');
    }
  }

  private mergeObjectMetadata(
    metadata?: Record<string, unknown>,
    tags?: string[],
  ): Record<string, unknown> {
    const merged = { ...(metadata ?? {}) };
    if (tags?.length) {
      merged.tags = tags;
    }
    return merged;
  }

  private hasUpdateFields(dto: UpdateKnowledgeDocumentDto): boolean {
    return dto.title !== undefined
      || dto.metadata !== undefined
      || dto.tags !== undefined;
  }
}
