import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { FileEntity } from './entities/file.entity';

@Injectable()
export class FilesService {
  constructor(
    @InjectRepository(FileEntity)
    private readonly fileRepository: Repository<FileEntity>,
  ) {}

  async create(
    userId: string,
    file: Express.Multer.File,
  ): Promise<FileEntity> {
    const entity = this.fileRepository.create({
      userId,
      originalName: file.originalname,
      storedName: file.filename,
      mimeType: file.mimetype,
      size: file.size,
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

  async linkToMessage(fileIds: string[], messageId: string): Promise<void> {
    if (!fileIds.length) return;
    await this.fileRepository.update(
      { id: In(fileIds) },
      { messageId },
    );
  }

  async delete(id: string, userId: string): Promise<void> {
    const file = await this.fileRepository.findOne({
      where: { id, userId },
    });
    if (!file) throw new NotFoundException('File not found');
    await this.fileRepository.remove(file);
  }
}
