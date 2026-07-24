import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  StreamableFile,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../users/entities/user.entity';
import { CreateRopDocumentAnalysisLinkDto } from './dto/create-rop-document-analysis-link.dto';
import { RopDocumentListItemResponseDto } from './dto/rop-document-list-item-response.dto';
import { RopDocumentResponseDto } from './dto/rop-document-response.dto';
import { mapRopDocument } from './rop-document.mapper';
import {
  assertAnalyzeUploadFile,
  getAnalyzeUploadProfileByCategoryId,
} from './rop-analyze-upload-profile';
import { RopDocumentLinkDownloadService } from './rop-document-link-download.service';
import { RopService } from './rop.service';

@Injectable()
export class RopDocumentsService {
  private static readonly GENERAL_CATEGORY_ID = 1;
  private static readonly DASHBOARD_CATEGORY_ID = 6;

  constructor(
    private readonly ropService: RopService,
    private readonly linkDownloadService: RopDocumentLinkDownloadService,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
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

  async uploadDashboardForAnalyzeForUser(
    userId: string,
    file: Express.Multer.File,
  ): Promise<RopDocumentResponseDto> {
    return this.uploadForAnalyzeForUser(
      userId,
      file,
      RopDocumentsService.DASHBOARD_CATEGORY_ID,
    );
  }

  async createDashboardFromLinkForAnalyzeForUser(
    userId: string,
    dto: CreateRopDocumentAnalysisLinkDto,
  ): Promise<RopDocumentResponseDto> {
    return this.createFromLinkForAnalyzeForUser(
      userId,
      dto,
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

    throw new BadRequestException('Сначала заполните анкету');
  }
}
