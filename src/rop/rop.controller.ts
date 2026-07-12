import {
  Controller,
  Get,
  Param,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { CurrentUserData } from '../auth/decorators/current-user.decorator';
import { SessionGuard } from '../auth/guards/session.guard';
import { ListRopTasksQueryDto } from './dto/list-rop-tasks-query.dto';
import { RopDocumentResponseDto } from './dto/rop-document-response.dto';
import { RopStatusResponseDto } from './dto/rop-status-response.dto';
import { RopTaskResponseDto } from './dto/rop-task-response.dto';
import { RopDocumentsService } from './rop-documents.service';
import { RopStatusService } from './rop-status.service';
import { RopTasksService } from './rop-tasks.service';

@ApiTags('rop')
@Controller('rop')
@UseGuards(SessionGuard)
export class RopController {
  constructor(
    private readonly ropDocumentsService: RopDocumentsService,
    private readonly ropStatusService: RopStatusService,
    private readonly ropTasksService: RopTasksService,
  ) {}

  @Get('status')
  @ApiOperation({ summary: 'Get current user ROP integration status' })
  @ApiOkResponse({ type: RopStatusResponseDto })
  async getStatus(@CurrentUser() user: CurrentUserData): Promise<RopStatusResponseDto> {
    return this.ropStatusService.getForUser(user.id);
  }

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

  @Get('tasks')
  @ApiOperation({ summary: 'List ROP project tasks for the current user' })
  @ApiOkResponse({ type: RopTaskResponseDto, isArray: true })
  async listTasks(
    @CurrentUser() user: CurrentUserData,
    @Query() query: ListRopTasksQueryDto,
  ): Promise<RopTaskResponseDto[]> {
    return this.ropTasksService.listForUser(user.id, query);
  }

  @Get('tasks/:taskId')
  @ApiOperation({ summary: 'Get a ROP project task by ID' })
  @ApiParam({ name: 'taskId', description: 'ROP task ID' })
  @ApiOkResponse({ type: RopTaskResponseDto })
  async getTask(
    @CurrentUser() user: CurrentUserData,
    @Param('taskId') taskId: string,
  ): Promise<RopTaskResponseDto> {
    return this.ropTasksService.getForUser(user.id, taskId);
  }
}
