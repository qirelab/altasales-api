import { BadRequestException, Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import { OrderItem } from '../orders/entities/order-item.entity';
import { RopService } from '../rop/rop.service';
import { User } from '../users/entities/user.entity';
import { FileEntity, FileSource } from './entities/file.entity';

@Injectable()
export class FilesService {
  constructor(
    @InjectRepository(FileEntity)
    private readonly fileRepository: Repository<FileEntity>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(OrderItem)
    private readonly orderItemRepository: Repository<OrderItem>,
    private readonly ropService: RopService,
  ) {}

  private async getRopProjectId(userId: string): Promise<string> {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    if (user.ropProjectId) {
      return user.ropProjectId;
    }

    if (!this.ropService.isConfigured()) {
      throw new InternalServerErrorException('ROP API not configured');
    }

    throw new BadRequestException('Сначала заполните анкету');
  }

  private async resolveTargetUserId(
    currentUserId: string,
    source: FileSource,
    orderItemId?: string,
  ): Promise<string> {
    if (source !== FileSource.ADMIN || !orderItemId) {
      return currentUserId;
    }

    const orderItem = await this.orderItemRepository.findOne({
      where: { id: orderItemId },
      relations: ['order'],
    });

    if (!orderItem?.order?.userId) {
      throw new NotFoundException('Order item not found');
    }

    return orderItem.order.userId;
  }

  async create(
    userId: string,
    file: Express.Multer.File,
    orderItemId?: string,
    source: FileSource = FileSource.CLIENT,
    orderItemSubItemId?: string,
  ): Promise<FileEntity> {
    const targetUserId = await this.resolveTargetUserId(userId, source, orderItemId);
    const ropProjectId = await this.getRopProjectId(targetUserId);

    const ropDocument = await this.ropService.createDocument(
      ropProjectId,
      file.originalname,
    );

    await this.ropService.uploadFile(ropProjectId, ropDocument.id, file);

    const entity = this.fileRepository.create({
      userId: targetUserId,
      originalName: file.originalname,
      storedName: ropDocument.id,
      mimeType: file.mimetype,
      size: file.size,
      ropDocumentId: ropDocument.id,
      orderItemId: orderItemId ?? null,
      orderItemSubItemId: orderItemSubItemId ?? null,
      source,
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

  async delete(id: string): Promise<void> {
    const file = await this.fileRepository.findOne({ where: { id } });
    if (!file) throw new NotFoundException('File not found');
    await this.fileRepository.remove(file);
  }
}
