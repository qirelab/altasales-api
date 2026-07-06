import {
  Controller,
  Get,
  Param,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { CurrentUserData } from '../auth/decorators/current-user.decorator';
import { SessionGuard } from '../auth/guards/session.guard';
import { RopDocumentResponseDto } from './dto/rop-document-response.dto';
import { RopDocumentsService } from './rop-documents.service';

@ApiTags('rop')
@Controller('rop')
@UseGuards(SessionGuard)
export class RopController {
  constructor(private readonly ropDocumentsService: RopDocumentsService) {}

  @Get('documents')
  @ApiOperation({ summary: 'List ROP project documents for the current user' })
  @ApiOkResponse({ type: RopDocumentResponseDto, isArray: true })
  async listDocuments(@CurrentUser() user: CurrentUserData): Promise<RopDocumentResponseDto[]> {
    return this.ropDocumentsService.listForUser(user.id);
  }

  @Get('documents/:documentId/download')
  @ApiOperation({ summary: 'Redirect to ROP document download URL' })
  @ApiParam({ name: 'documentId', description: 'ROP document ID' })
  @ApiResponse({ status: 302, description: 'Redirect to presigned download URL' })
  async downloadDocument(
    @CurrentUser() user: CurrentUserData,
    @Param('documentId') documentId: string,
    @Res() res: Response,
  ): Promise<void> {
    const downloadUrl = await this.ropDocumentsService.getDownloadUrlForUser(user.id, documentId);
    res.redirect(downloadUrl);
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
