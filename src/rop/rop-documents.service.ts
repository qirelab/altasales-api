import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  StreamableFile,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Questionnaire } from '../questionnaires/entities/questionnaire.entity';
import { User } from '../users/entities/user.entity';
import { CreateRopDocumentAnalysisLinkDto } from './dto/create-rop-document-analysis-link.dto';
import { CreateRopDashboardAnalysisLinkDto } from './dto/create-rop-dashboard-analysis-link.dto';
import { RopDocumentListItemResponseDto } from './dto/rop-document-list-item-response.dto';
import { RopDocumentResponseDto } from './dto/rop-document-response.dto';
import { RopDashboardFileInspectResponseDto } from './dto/rop-dashboard-file-inspect-response.dto';
import { RopLinkAccessResponseDto } from './dto/rop-link-access-response.dto';
import { mapRopDocument } from './rop-document.mapper';
import {
  assertAnalyzeUploadFile,
  getAnalyzeUploadProfileByCategoryId,
  ROP_DASHBOARD_ANALYZE_UPLOAD_PROFILE,
  ROP_DOCUMENT_ANALYZE_UPLOAD_PROFILE,
} from './rop-analyze-upload-profile';
import { RopDashboardFilePartsService } from './rop-dashboard-file-parts.service';
import { RopDocumentLinkDownloadService } from './rop-document-link-download.service';
import { RopProvisioningService } from './rop-provisioning.service';
import { RopService } from './rop.service';

@Injectable()
export class RopDocumentsService {
  private static readonly GENERAL_CATEGORY_ID = 1;
  private static readonly DASHBOARD_CATEGORY_ID = 6;

  constructor(
    private readonly ropService: RopService,
    private readonly ropProvisioningService: RopProvisioningService,
    private readonly linkDownloadService: RopDocumentLinkDownloadService,
    private readonly dashboardFilePartsService: RopDashboardFilePartsService,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(Questionnaire)
    private readonly questionnaireRepository: Repository<Questionnaire>,
  ) {}

  async listForUser(userId: string): Promise<RopDocumentListItemResponseDto[]> {
    const projectId = await this.getProjectId(userId);
    if (!projectId) {
      return [];
    }

    const documents = await this.ropService.listDocuments(projectId);
    return documents.map((document) => ({
      name: document.name,
      downloadUrl: `/rop/documents/${encodeURIComponent(String(document.id))}/download`,
    }));
  }

  async getForUser(
    userId: string,
    documentId: string,
  ): Promise<RopDocumentResponseDto> {
    const projectId = await this.requireProjectId(userId);
    const document = await this.ropService.getDocument(projectId, documentId);
    return mapRopDocument(document);
  }

  async getDownloadUrlForUser(
    userId: string,
    documentId: string,
  ): Promise<string> {
    const projectId = await this.requireProjectId(userId);
    return this.ropService.getDownloadUrl(projectId, documentId);
  }

  async uploadForAnalyzeForUser(
    userId: string,
    file: Express.Multer.File,
    categoryId: number = RopDocumentsService.GENERAL_CATEGORY_ID,
  ): Promise<RopDocumentResponseDto> {
    const profile = getAnalyzeUploadProfileByCategoryId(
      categoryId,
      RopDocumentsService.DASHBOARD_CATEGORY_ID,
    );
    assertAnalyzeUploadFile(file, profile);

    const projectId = await this.requireProjectId(userId);
    const document = await this.ropService.createDocument(
      projectId,
      file.originalname,
      { categoryId },
    );
    await this.ropService.uploadFile(projectId, document.id, file);
    return this.getForUser(userId, document.id);
  }

  async createFromLinkForAnalyzeForUser(
    userId: string,
    dto: CreateRopDocumentAnalysisLinkDto,
    categoryId: number = RopDocumentsService.GENERAL_CATEGORY_ID,
  ): Promise<RopDocumentResponseDto> {
    const profile = getAnalyzeUploadProfileByCategoryId(
      categoryId,
      RopDocumentsService.DASHBOARD_CATEGORY_ID,
    );
    const file = await this.linkDownloadService.downloadAsFile(
      dto.link,
      dto.name,
      profile,
    );
    return this.uploadForAnalyzeForUser(userId, file, categoryId);
  }

  async inspectDashboardFileForUser(
    file: Express.Multer.File,
  ): Promise<RopDashboardFileInspectResponseDto> {
    assertAnalyzeUploadFile(file, ROP_DASHBOARD_ANALYZE_UPLOAD_PROFILE);
    return this.dashboardFilePartsService.inspect(file);
  }

  async inspectDashboardLinkForUser(
    dto: CreateRopDocumentAnalysisLinkDto,
  ): Promise<RopDashboardFileInspectResponseDto> {
    const file = await this.linkDownloadService.downloadAsFile(
      dto.link,
      dto.name,
      ROP_DASHBOARD_ANALYZE_UPLOAD_PROFILE,
    );
    return this.dashboardFilePartsService.inspect(file);
  }

  async inspectDocumentLinkForUser(
    dto: CreateRopDocumentAnalysisLinkDto,
  ): Promise<RopLinkAccessResponseDto> {
    await this.linkDownloadService.downloadAsFile(
      dto.link,
      dto.name,
      ROP_DOCUMENT_ANALYZE_UPLOAD_PROFILE,
    );

    return { accessible: true };
  }

  async uploadDashboardForAnalyzeForUser(
    userId: string,
    file: Express.Multer.File,
    partId?: string,
  ): Promise<RopDocumentResponseDto> {
    const preparedFile = partId
      ? await this.dashboardFilePartsService.extractPart(file, partId)
      : file;

    return this.uploadForAnalyzeForUser(
      userId,
      preparedFile,
      RopDocumentsService.DASHBOARD_CATEGORY_ID,
    );
  }

  async createDashboardFromLinkForAnalyzeForUser(
    userId: string,
    dto: CreateRopDashboardAnalysisLinkDto,
  ): Promise<RopDocumentResponseDto> {
    const file = await this.linkDownloadService.downloadAsFile(
      dto.link,
      dto.name,
      ROP_DASHBOARD_ANALYZE_UPLOAD_PROFILE,
    );
    const preparedFile = dto.partId
      ? await this.dashboardFilePartsService.extractPart(file, dto.partId)
      : file;

    return this.uploadForAnalyzeForUser(
      userId,
      preparedFile,
      RopDocumentsService.DASHBOARD_CATEGORY_ID,
    );
  }

  async getAnalyzeForUser(
    userId: string,
    documentId: string,
  ): Promise<Record<string, unknown>> {
    const projectId = await this.requireProjectId(userId);
    return this.ropService.getDocumentAnalyze(projectId, documentId);
  }

  async downloadForUser(
    userId: string,
    documentId: string,
  ): Promise<StreamableFile> {
    const downloadUrl = await this.getDownloadUrlForUser(userId, documentId);
    const upstream = await fetch(downloadUrl);

    if (!upstream.ok) {
      throw new InternalServerErrorException(
        'Failed to download document from ROP',
      );
    }

    const buffer = Buffer.from(await upstream.arrayBuffer());
    const contentType =
      upstream.headers.get('content-type') ?? 'application/octet-stream';
    const disposition =
      upstream.headers.get('content-disposition') ?? 'attachment';

    return new StreamableFile(buffer, {
      type: contentType,
      disposition,
    });
  }

  private async getProjectId(userId: string): Promise<string | null> {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    return user.ropProjectId;
  }

  private async requireProjectId(userId: string): Promise<string> {
    const projectId = await this.getProjectId(userId);
    if (projectId) {
      return projectId;
    }

    if (!this.ropService.isConfigured()) {
      throw new InternalServerErrorException('ROP API not configured');
    }

    const questionnaire = await this.questionnaireRepository.findOne({
      where: { userId },
    });
    if (!questionnaire) {
      throw new BadRequestException('Сначала заполните анкету');
    }

    const provisionedProjectId = await this.ropProvisioningService.ensureProjectForUser(
      userId,
      questionnaire.answers.companyName,
    );
    if (!provisionedProjectId) {
      throw new InternalServerErrorException('Не удалось создать проект ROP');
    }

    return provisionedProjectId;
  }
}
