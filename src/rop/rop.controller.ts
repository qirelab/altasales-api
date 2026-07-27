import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBody,
  ApiConsumes,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { CurrentUserData } from '../auth/decorators/current-user.decorator';
import { SessionGuard } from '../auth/guards/session.guard';
import { CreateRopDocumentAnalysisLinkDto } from './dto/create-rop-document-analysis-link.dto';
import { RopDocumentListItemResponseDto } from './dto/rop-document-list-item-response.dto';
import { RopDocumentResponseDto } from './dto/rop-document-response.dto';
import { RopDocumentsService } from './rop-documents.service';

@ApiTags('rop')
@Controller('rop')
@UseGuards(SessionGuard)
export class RopController {
  constructor(private readonly ropDocumentsService: RopDocumentsService) {}

  @Get('documents')
  @ApiOperation({ summary: 'List ROP project documents for the current user' })
  @ApiOkResponse({ type: RopDocumentListItemResponseDto, isArray: true })
  async listDocuments(
    @CurrentUser() user: CurrentUserData,
  ): Promise<RopDocumentListItemResponseDto[]> {
    return this.ropDocumentsService.listForUser(user.id);
  }

  @Post('documents/analyze/upload')
  @ApiOperation({
    summary: 'Upload a document to ROP and start its AI analysis',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: {
        file: { type: 'string', format: 'binary' },
      },
    },
  })
  @ApiCreatedResponse({ type: RopDocumentResponseDto })
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 20 * 1024 * 1024 } }),
  )
  async uploadDocumentForAnalyze(
    @CurrentUser() user: CurrentUserData,
    @UploadedFile() file: Express.Multer.File,
  ): Promise<RopDocumentResponseDto> {
    if (!file) {
      throw new BadRequestException('Файл не предоставлен');
    }

    return this.ropDocumentsService.uploadForAnalyzeForUser(user.id, file);
  }

  @Post('documents/analyze/link')
  @ApiOperation({
    summary: 'Download a document by URL and upload it to ROP for AI analysis',
  })
  @ApiCreatedResponse({ type: RopDocumentResponseDto })
  async createDocumentFromLinkForAnalyze(
    @CurrentUser() user: CurrentUserData,
    @Body() dto: CreateRopDocumentAnalysisLinkDto,
  ): Promise<RopDocumentResponseDto> {
    return this.ropDocumentsService.createFromLinkForAnalyzeForUser(
      user.id,
      dto,
    );
  }

  @Get('documents/:documentId/analyze')
  @ApiOperation({ summary: 'Get ROP document AI analysis result' })
  @ApiParam({ name: 'documentId', description: 'ROP document ID' })
  @ApiOkResponse({ description: 'Document AI analysis status and result' })
  async getDocumentAnalyze(
    @CurrentUser() user: CurrentUserData,
    @Param('documentId') documentId: string,
  ): Promise<Record<string, unknown>> {
    return this.ropDocumentsService.getAnalyzeForUser(user.id, documentId);
  }

  @Get('documents/:documentId/download')
  @ApiOperation({ summary: 'Download a ROP project document' })
  @ApiParam({ name: 'documentId', description: 'ROP document ID' })
  @ApiProduces('application/octet-stream')
  @ApiOkResponse({ description: 'Document file stream' })
  async downloadDocument(
    @CurrentUser() user: CurrentUserData,
    @Param('documentId') documentId: string,
  ): Promise<StreamableFile> {
    return this.ropDocumentsService.downloadForUser(user.id, documentId);
  }

  @Get('documents/:documentId')
  @ApiOperation({ summary: 'Get a ROP project document by ID' })
  @ApiParam({ name: 'documentId', description: 'ROP document ID' })
  @ApiOkResponse({ type: RopDocumentResponseDto })
  async getDocument(
    @CurrentUser() user: CurrentUserData,
    @Param('documentId') documentId: string,
  ): Promise<RopDocumentResponseDto> {
    return this.ropDocumentsService.getForUser(user.id, documentId);
  }
}
