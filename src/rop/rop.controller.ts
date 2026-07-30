import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
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
import { CreateRopDashboardAnalysisLinkDto } from './dto/create-rop-dashboard-analysis-link.dto';
import { ListRopTasksQueryDto } from './dto/list-rop-tasks-query.dto';
import { RopDashboardFileInspectResponseDto } from './dto/rop-dashboard-file-inspect-response.dto';
import { RopLinkAccessResponseDto } from './dto/rop-link-access-response.dto';
import { RopDocumentListItemResponseDto } from './dto/rop-document-list-item-response.dto';
import { RopDocumentResponseDto } from './dto/rop-document-response.dto';
import {
  RopBenchmarkDecompositionQueryDto,
  RopIntervalDashboardQueryDto,
  RopMonthDashboardQueryDto,
} from './dto/rop-indicators-query.dto';
import { RopMeetingResponseDto } from './dto/rop-meeting-response.dto';
import { RopTaskResponseDto } from './dto/rop-task-response.dto';
import { RopDocumentsService } from './rop-documents.service';
import { RopIndicatorsService } from './rop-indicators.service';
import { RopMeetingsService } from './rop-meetings.service';
import { RopTasksService } from './rop-tasks.service';

@ApiTags('rop')
@Controller('rop')
@UseGuards(SessionGuard)
export class RopController {
  constructor(
    private readonly ropDocumentsService: RopDocumentsService,
    private readonly ropIndicatorsService: RopIndicatorsService,
    private readonly ropMeetingsService: RopMeetingsService,
    private readonly ropTasksService: RopTasksService,
  ) {}

  @Get('indicators/month-dashboard')
  @ApiOperation({
    summary: 'Get ROP month dashboard for current user project department',
  })
  async getMonthDashboard(
    @CurrentUser() user: CurrentUserData,
    @Query() query: RopMonthDashboardQueryDto,
  ): Promise<Record<string, unknown>> {
    return this.ropIndicatorsService.getMonthDashboardForUser(user.id, query);
  }

  @Get('indicators/interim-report')
  @ApiOperation({
    summary:
      'Get ROP interval dashboard (interim report) for current user project department',
  })
  async getInterimReport(
    @CurrentUser() user: CurrentUserData,
    @Query() query: RopIntervalDashboardQueryDto,
  ): Promise<Record<string, unknown>> {
    return this.ropIndicatorsService.getIntervalDashboardForUser(
      user.id,
      query,
    );
  }

  @Get('indicators/decomposition')
  @ApiOperation({
    summary:
      'Get ROP benchmark decomposition for current user project department',
  })
  async getDecomposition(
    @CurrentUser() user: CurrentUserData,
    @Query() query: RopBenchmarkDecompositionQueryDto,
  ): Promise<Record<string, unknown>> {
    return this.ropIndicatorsService.getBenchmarkDecompositionForUser(
      user.id,
      query,
    );
  }

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

  @Post('documents/analyze/inspect-link')
  @ApiOperation({
    summary: 'Check whether a document link is accessible and downloadable',
  })
  @ApiOkResponse({ type: RopLinkAccessResponseDto })
  async inspectDocumentFromLink(
    @CurrentUser() user: CurrentUserData,
    @Body() dto: CreateRopDocumentAnalysisLinkDto,
  ): Promise<RopLinkAccessResponseDto> {
    void user;
    return this.ropDocumentsService.inspectDocumentLinkForUser(dto);
  }

  @Post('dashboards/analyze/inspect')
  @ApiOperation({
    summary: 'Inspect a dashboard file and list selectable pages or sheets',
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
  @ApiOkResponse({ type: RopDashboardFileInspectResponseDto })
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 25 * 1024 * 1024 } }),
  )
  async inspectDashboardFile(
    @CurrentUser() user: CurrentUserData,
    @UploadedFile() file: Express.Multer.File,
  ): Promise<RopDashboardFileInspectResponseDto> {
    void user;
    if (!file) {
      throw new BadRequestException('Файл не предоставлен');
    }

    return this.ropDocumentsService.inspectDashboardFileForUser(file);
  }

  @Post('dashboards/analyze/inspect-link')
  @ApiOperation({
    summary:
      'Download a dashboard file by URL and list selectable pages or sheets',
  })
  @ApiOkResponse({ type: RopDashboardFileInspectResponseDto })
  async inspectDashboardFromLink(
    @CurrentUser() user: CurrentUserData,
    @Body() dto: CreateRopDocumentAnalysisLinkDto,
  ): Promise<RopDashboardFileInspectResponseDto> {
    void user;
    return this.ropDocumentsService.inspectDashboardLinkForUser(dto);
  }

  @Post('dashboards/analyze/upload')
  @ApiOperation({
    summary: 'Upload a dashboard file to ROP and start its AI analysis',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: {
        file: { type: 'string', format: 'binary' },
        partId: { type: 'string', example: 'page:2' },
      },
    },
  })
  @ApiCreatedResponse({ type: RopDocumentResponseDto })
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 25 * 1024 * 1024 } }),
  )
  async uploadDashboardForAnalyze(
    @CurrentUser() user: CurrentUserData,
    @UploadedFile() file: Express.Multer.File,
    @Body('partId') partId?: string,
  ): Promise<RopDocumentResponseDto> {
    if (!file) {
      throw new BadRequestException('Файл не предоставлен');
    }

    return this.ropDocumentsService.uploadDashboardForAnalyzeForUser(
      user.id,
      file,
      partId?.trim() || undefined,
    );
  }

  @Post('dashboards/analyze/link')
  @ApiOperation({
    summary:
      'Download a dashboard file by URL and upload it to ROP for AI analysis',
  })
  @ApiCreatedResponse({ type: RopDocumentResponseDto })
  async createDashboardFromLinkForAnalyze(
    @CurrentUser() user: CurrentUserData,
    @Body() dto: CreateRopDashboardAnalysisLinkDto,
  ): Promise<RopDocumentResponseDto> {
    return this.ropDocumentsService.createDashboardFromLinkForAnalyzeForUser(
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

  @Get('meetings')
  @ApiOperation({ summary: 'List ROP project meetings for the current user' })
  @ApiOkResponse({ type: RopMeetingResponseDto, isArray: true })
  async listMeetings(
    @CurrentUser() user: CurrentUserData,
  ): Promise<RopMeetingResponseDto[]> {
    return this.ropMeetingsService.listForUser(user.id);
  }

  @Get('meetings/:meetingId')
  @ApiOperation({ summary: 'Get a ROP project meeting by ID' })
  @ApiParam({ name: 'meetingId', description: 'ROP meeting ID' })
  @ApiOkResponse({ type: RopMeetingResponseDto })
  async getMeeting(
    @CurrentUser() user: CurrentUserData,
    @Param('meetingId') meetingId: string,
  ): Promise<RopMeetingResponseDto> {
    return this.ropMeetingsService.getForUser(user.id, meetingId);
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
