import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { FileEntity } from './entities/file.entity';
import { User } from '../users/entities/user.entity';
import { RopService } from '../rop/rop.service';

@Injectable()
export class FilesService {
  private readonly logger = new Logger(FilesService.name);

  constructor(
    @InjectRepository(FileEntity)
    private readonly fileRepository: Repository<FileEntity>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly ropService: RopService,
  ) {}

  private async getOrCreateRopProject(userId: string): Promise<string> {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    if (user.ropProjectId) {
      return user.ropProjectId;
    }

    const project = await this.ropService.createProject(
      `altasales-user-${userId}`,
    );

    await this.userRepository.update(userId, { ropProjectId: project.id });
    this.logger.log(`Created ROP project ${project.id} for user ${userId}`);

    return project.id;
  }

  async create(
    userId: string,
    file: Express.Multer.File,
    orderItemId?: string,
  ): Promise<FileEntity> {
    const ropProjectId = await this.getOrCreateRopProject(userId);

    const ropDocument = await this.ropService.createDocument(
      ropProjectId,
      file.originalname,
    );

    await this.ropService.uploadFile(ropProjectId, ropDocument.id, file);

    const entity = this.fileRepository.create({
      userId,
      originalName: file.originalname,
      storedName: ropDocument.id,
      mimeType: file.mimetype,
      size: file.size,
      ropDocumentId: ropDocument.id,
      orderItemId: orderItemId ?? null,
    });

    return this.fileRepository.save(entity);
  }

  async findById(id: string): Promise<FileEntity> {
    const file = await this.fileRepository.findOne({ where: { id } });
    if (!file) throw new NotFoundException('File not found');
    return file;
  }

  async findByIds(ids: string[]): Promise<FileEntity[]> {
    if (!ids.length) return [];
    return this.fileRepository.findBy({ id: In(ids) });
  }

  async findByMessageIds(messageIds: string[]): Promise<FileEntity[]> {
    if (!messageIds.length) return [];
    return this.fileRepository.findBy({ messageId: In(messageIds) });
  }

  async findByOrderItemId(orderItemId: string): Promise<FileEntity[]> {
    return this.fileRepository.findBy({ orderItemId });
  }

  async findByOrderItemIds(orderItemIds: string[]): Promise<FileEntity[]> {
    if (!orderItemIds.length) return [];
    return this.fileRepository.findBy({ orderItemId: In(orderItemIds) });
  }

  async linkToMessage(fileIds: string[], messageId: string): Promise<void> {
    if (!fileIds.length) return;
    await this.fileRepository.update(
      { id: In(fileIds) },
      { messageId },
    );
  }

  async linkToOrderItem(fileIds: string[], orderItemId: string): Promise<void> {
    if (!fileIds.length) return;
    await this.fileRepository.update(
      { id: In(fileIds) },
      { orderItemId },
    );
  }

  async getDownloadUrl(id: string): Promise<string> {
    const file = await this.fileRepository.findOne({
      where: { id },
      relations: ['user'],
    });
    if (!file) throw new NotFoundException('File not found');

    if (!file.ropDocumentId || !file.user?.ropProjectId) {
      throw new NotFoundException('File not found in ROP storage');
    }

    return this.ropService.getDownloadUrl(file.user.ropProjectId, file.ropDocumentId);
  }
}
