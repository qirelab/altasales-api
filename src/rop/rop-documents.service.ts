import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { User } from '../users/entities/user.entity';
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

  async getForUser(userId: string, documentId: string): Promise<RopDocumentResponseDto> {
    const projectId = await this.requireProjectId(userId);
    const document = await this.ropService.getDocument(projectId, documentId);
    return mapRopDocument(document);
  }

  async getDownloadUrlForUser(userId: string, documentId: string): Promise<string> {
    const projectId = await this.requireProjectId(userId);
    return this.ropService.getDownloadUrl(projectId, documentId);
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
