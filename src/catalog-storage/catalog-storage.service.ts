import { randomUUID } from 'crypto';
import { mkdir, writeFile } from 'fs/promises';
import { dirname, extname, join } from 'path';
import { BadRequestException, Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CATALOG_IMAGE_FORMATS_LABEL,
  CATALOG_IMAGE_MAX_BYTES,
  isCatalogImageAllowed,
  type CatalogStorageFolder,
} from './catalog-storage.constants';

@Injectable()
export class CatalogStorageService {
  private readonly logger = new Logger(CatalogStorageService.name);
  private readonly uploadRoot: string;
  private readonly publicBaseUrl: string;

  constructor(private readonly configService: ConfigService) {
    this.uploadRoot = this.configService.get<string>('CATALOG_UPLOAD_DIR')
      ?? join(process.cwd(), 'uploads');
    const baseUrl = this.configService.get<string>('CATALOG_PUBLIC_BASE_URL')
      ?? `http://localhost:${this.configService.get<string>('PORT') ?? '4000'}/uploads`;
    this.publicBaseUrl = baseUrl.replace(/\/$/, '');
  }

  async uploadImage(
    file: Express.Multer.File,
    folder: CatalogStorageFolder,
  ): Promise<{ url: string; storagePath: string }> {
    this.assertValidFile(file);

    const extension = this.resolveExtension(file);
    const storagePath = `catalog/${folder}/${randomUUID()}${extension}`;
    const absolutePath = join(this.uploadRoot, storagePath);

    try {
      await mkdir(dirname(absolutePath), { recursive: true });
      await writeFile(absolutePath, file.buffer);
    } catch (error) {
      this.logger.error(`Catalog image save failed: ${String(error)}`);
      throw new InternalServerErrorException('Не удалось загрузить изображение');
    }

    const url = `${this.publicBaseUrl}/${storagePath.replace(/\\/g, '/')}`;
    return { url, storagePath };
  }

  private assertValidFile(file: Express.Multer.File | undefined): asserts file is Express.Multer.File {
    if (!file) {
      throw new BadRequestException('Файл не предоставлен');
    }
    if (!isCatalogImageAllowed(file)) {
      throw new BadRequestException(`Допустимые форматы: ${CATALOG_IMAGE_FORMATS_LABEL}`);
    }
    if (file.size > CATALOG_IMAGE_MAX_BYTES) {
      throw new BadRequestException('Максимальный размер изображения — 5 МБ');
    }
    if (!file.buffer?.length) {
      throw new BadRequestException('Файл пустой');
    }
  }

  private resolveExtension(file: Express.Multer.File): string {
    const fromName = extname(file.originalname).toLowerCase();
    if (
      fromName === '.jpg'
      || fromName === '.jpeg'
      || fromName === '.png'
      || fromName === '.webp'
      || fromName === '.heic'
      || fromName === '.heif'
    ) {
      return fromName === '.jpg' ? '.jpeg' : fromName;
    }

    const byMime: Record<string, string> = {
      'image/jpeg': '.jpeg',
      'image/png': '.png',
      'image/webp': '.webp',
      'image/heic': '.heic',
      'image/heif': '.heif',
    };
    return byMime[file.mimetype] ?? '.jpeg';
  }
}
