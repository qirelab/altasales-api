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
import { RopDocumentListItemResponseDto } from './dto/rop-document-list-item-response.dto';
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
