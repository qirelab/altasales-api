import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../users/entities/user.entity';
import { CreateRopDocumentAnalysisLinkDto } from './dto/create-rop-document-analysis-link.dto';
import { RopDocumentResponseDto } from './dto/rop-document-response.dto';
import { mapRopDocument } from './rop-document.mapper';
import { RopService } from './rop.service';

@Injectable()
export class RopDocumentsService {
  constructor(
    private readonly ropService: RopService,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  async listForUser(userId: string): Promise<RopDocumentResponseDto[]> {
    const projectId = await this.getProjectId(userId);
    if (!projectId) {
      return [];
    }

    const documents = await this.ropService.listDocuments(projectId);
    return documents.map(mapRopDocument);
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
  ): Promise<RopDocumentResponseDto> {
    const projectId = await this.requireProjectId(userId);
    const document = await this.ropService.createDocument(
      projectId,
      file.originalname,
    );
    await this.ropService.uploadFile(projectId, document.id, file);
    return this.getForUser(userId, document.id);
  }

  async createFromLinkForAnalyzeForUser(
    userId: string,
    dto: CreateRopDocumentAnalysisLinkDto,
  ): Promise<RopDocumentResponseDto> {
    const projectId = await this.requireProjectId(userId);
    const document = await this.ropService.createDocument(
      projectId,
      dto.name ?? this.getDocumentNameFromLink(dto.link),
      dto.link,
    );
    return this.getForUser(userId, document.id);
  }

  async getAnalyzeForUser(
    userId: string,
    documentId: string,
  ): Promise<Record<string, unknown>> {
    const projectId = await this.requireProjectId(userId);
    return this.ropService.getDocumentAnalyze(projectId, documentId);
  }

  private getDocumentNameFromLink(link: string): string {
    const url = new URL(link);
    const fileName = url.pathname.split('/').filter(Boolean).at(-1);
    return fileName || url.hostname;
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
