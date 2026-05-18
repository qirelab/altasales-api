import {
  Controller,
  Post,
  Get,
  Delete,
  Param,
  Res,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  ParseUUIDPipe,
  BadRequestException,
  Query,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';
import { ApiTags, ApiOperation, ApiConsumes, ApiBody, ApiResponse, ApiQuery } from '@nestjs/swagger';
import { memoryStorage } from 'multer';
import type { Response } from 'express';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { CurrentUserData } from '../auth/decorators/current-user.decorator';
import { SessionGuard } from '../auth/guards/session.guard';
import { FilesService } from './files.service';
import { FileSource } from './entities/file.entity';

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

interface MulterUtf8Options extends MulterOptions {
  defParamCharset?: string;
}

const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain',
  'text/csv',
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/zip',
  'application/x-rar-compressed',
];

const fileUploadOptions = {
  storage: memoryStorage(),
  defParamCharset: 'utf8',
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new BadRequestException('Недопустимый тип файла'), false);
    }
  },
} satisfies MulterUtf8Options;

@ApiTags('files')
@Controller('files')
@UseGuards(SessionGuard)
export class FilesController {
  constructor(private readonly filesService: FilesService) {}

  @Post('upload')
  @ApiOperation({ summary: 'Upload a file to ROP storage' })
  @ApiConsumes('multipart/form-data')
  @ApiQuery({ name: 'orderItemId', required: false, description: 'Order item ID to attach file to' })
  @ApiQuery({ name: 'source', required: false, enum: FileSource, description: 'File source (client or admin)' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @ApiResponse({ status: 201, description: 'File uploaded to ROP' })
  @UseInterceptors(
    FileInterceptor('file', fileUploadOptions),
  )
  async upload(
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: CurrentUserData,
    @Query('orderItemId') orderItemId?: string,
    @Query('source') source?: FileSource,
  ) {
    if (!file) throw new BadRequestException('Файл не предоставлен');

    // Only admin can upload files with source=admin
    const fileSource = source === FileSource.ADMIN && user.role === 'admin'
      ? FileSource.ADMIN
      : FileSource.CLIENT;

    const entity = await this.filesService.create(user.id, file, orderItemId, fileSource);
    return {
      id: entity.id,
      name: entity.originalName,
      size: entity.size,
      type: entity.mimeType,
      source: entity.source,
    };
  }

  @Get(':id/download')
  @ApiOperation({ summary: 'Get download URL for a file' })
  @ApiResponse({ status: 302, description: 'Redirect to presigned download URL' })
  async download(
    @Param('id', ParseUUIDPipe) id: string,
    @Res() res: Response,
  ) {
    const downloadUrl = await this.filesService.getDownloadUrl(id);
    res.redirect(downloadUrl);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a file' })
  @ApiResponse({ status: 200, description: 'File deleted' })
  async delete(@Param('id', ParseUUIDPipe) id: string) {
    await this.filesService.delete(id);
    return { success: true };
  }
}
