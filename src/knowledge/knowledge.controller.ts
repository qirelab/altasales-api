import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
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
import { extname } from 'path';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { SessionGuard } from '../auth/guards/session.guard';
import { UserRole } from '../users/entities/user-role.enum';
import { ListKnowledgeDocumentsDto } from './dto/list-knowledge-documents.dto';
import { SearchKnowledgeDto } from './dto/search-knowledge.dto';
import { UploadKnowledgeDocumentDto } from './dto/upload-knowledge-document.dto';
import { KnowledgeDocumentsService } from './services/knowledge-documents.service';
import { KnowledgeSearchService } from './services/knowledge-search.service';

type UploadFileMetadata = {
  originalname: string;
  mimetype: string;
};

const DEFAULT_MAX_FILE_SIZE_MB = 100;
const SUPPORTED_MIME_TYPES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain',
  'text/csv',
  'text/markdown',
  'application/json',
  'application/octet-stream',
]);
const SUPPORTED_EXTENSIONS = new Set([
  '.pdf',
  '.docx',
  '.xlsx',
  '.txt',
  '.csv',
  '.json',
  '.md',
  '.markdown',
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
  return SUPPORTED_MIME_TYPES.has(file.mimetype)
    && SUPPORTED_EXTENSIONS.has(extension);
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
}
