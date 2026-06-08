import {
  BadRequestException,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { ApiBody, ApiConsumes, ApiCookieAuth, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Roles } from '../auth/decorators/roles.decorator';
import { SessionGuard } from '../auth/guards/session.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { UserRole } from '../users/entities/user-role.enum';
import { CatalogStorageService } from './catalog-storage.service';
import {
  CATALOG_IMAGE_FORMATS_LABEL,
  CATALOG_IMAGE_MAX_BYTES,
  CATALOG_STORAGE_FOLDERS,
  isCatalogImageAllowed,
  type CatalogStorageFolder,
} from './catalog-storage.constants';
import { UploadCatalogImageResponseDto } from './dto/upload-catalog-image-response.dto';

@ApiTags('catalog-storage')
@Controller('catalog-storage')
export class CatalogStorageController {
  constructor(private readonly catalogStorageService: CatalogStorageService) {}

  @Post('images/upload')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(SessionGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiCookieAuth('session')
  @ApiOperation({
    summary: 'Upload catalog image to server disk (admin)',
    description:
      'Saves file under uploads/catalog/ and returns a public URL for service.image or package.image.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiQuery({
    name: 'folder',
    required: true,
    enum: CATALOG_STORAGE_FOLDERS,
    description: 'Target folder: services or packages',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @ApiResponse({ status: 201, type: UploadCatalogImageResponseDto })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: CATALOG_IMAGE_MAX_BYTES },
      fileFilter: (_req, file, callback) => {
        if (!isCatalogImageAllowed(file)) {
          callback(new BadRequestException(`Допустимые форматы: ${CATALOG_IMAGE_FORMATS_LABEL}`), false);
          return;
        }
        callback(null, true);
      },
    }),
  )
  async uploadImage(
    @UploadedFile() file: Express.Multer.File,
    @Query('folder') folder: string,
  ): Promise<UploadCatalogImageResponseDto> {
    if (!CATALOG_STORAGE_FOLDERS.includes(folder as CatalogStorageFolder)) {
      throw new BadRequestException('folder должен быть services или packages');
    }

    return this.catalogStorageService.uploadImage(file, folder as CatalogStorageFolder);
  }
}
