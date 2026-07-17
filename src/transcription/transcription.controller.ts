import { randomUUID } from 'crypto';
import { mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { extname } from 'path';
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';
import { ApiBody, ApiConsumes, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { diskStorage } from 'multer';
import {
  CurrentUser,
  type CurrentUserData,
} from '../auth/decorators/current-user.decorator';
import { SessionGuard } from '../auth/guards/session.guard';
import { TranscriptionJobsService } from './transcription-jobs.service';

type UploadFileMetadata = {
  originalname: string;
  mimetype: string;
};

const DEFAULT_MAX_AUDIO_SIZE_MB = 100;
const DEFAULT_MAX_VIDEO_SIZE_MB = 500;
const SUPPORTED_AUDIO_TYPES = new Map([
  ['audio/mpeg', new Set(['.mp3'])],
  ['audio/wav', new Set(['.wav'])],
  ['audio/x-wav', new Set(['.wav'])],
  ['audio/ogg', new Set(['.ogg'])],
]);
const SUPPORTED_VIDEO_TYPES = new Map([
  ['video/mp4', new Set(['.mp4'])],
  ['video/webm', new Set(['.webm'])],
  ['video/quicktime', new Set(['.mov'])],
]);

function getMaxAudioSizeBytes(): number {
  const parsed = Number(process.env.TRANSCRIPTION_MAX_AUDIO_SIZE_MB);
  const sizeMb = Number.isFinite(parsed) && parsed > 0
    ? parsed
    : DEFAULT_MAX_AUDIO_SIZE_MB;
  return sizeMb * 1024 * 1024;
}

function getVideoTempBaseDir(): string {
  return process.env.TRANSCRIPTION_VIDEO_TEMP_DIR?.trim() || tmpdir();
}

export function getMaxVideoSizeBytes(): number {
  const parsed = Number(process.env.TRANSCRIPTION_MAX_VIDEO_SIZE_MB);
  const sizeMb = Number.isFinite(parsed) && parsed > 0
    ? parsed
    : DEFAULT_MAX_VIDEO_SIZE_MB;
  return sizeMb * 1024 * 1024;
}

export function isSupportedTranscriptionAudioFile(file: UploadFileMetadata): boolean {
  const extension = extname(file.originalname).toLowerCase();
  return SUPPORTED_AUDIO_TYPES.get(file.mimetype)?.has(extension) ?? false;
}

export function isSupportedTranscriptionVideoFile(file: UploadFileMetadata): boolean {
  const extension = extname(file.originalname).toLowerCase();
  return SUPPORTED_VIDEO_TYPES.get(file.mimetype)?.has(extension) ?? false;
}

export const audioUploadOptions = {
  limits: { fileSize: getMaxAudioSizeBytes() },
  fileFilter: (_req, file, cb) => {
    if (isSupportedTranscriptionAudioFile(file)) {
      cb(null, true);
      return;
    }

    cb(new BadRequestException('Unsupported audio file type'), false);
  },
} satisfies MulterOptions;

export const videoUploadOptions = {
  storage: diskStorage({
    destination: (_req, _file, cb) => {
      try {
        const baseDir = getVideoTempBaseDir();
        mkdirSync(baseDir, { recursive: true });
        cb(null, baseDir);
      } catch (error) {
        cb(error as Error, '');
      }
    },
    filename: (_req, file, cb) => {
      const extension = extname(file.originalname).toLowerCase();
      cb(null, `${randomUUID()}${extension}`);
    },
  }),
  limits: { fileSize: getMaxVideoSizeBytes() },
  fileFilter: (_req, file, cb) => {
    if (isSupportedTranscriptionVideoFile(file)) {
      cb(null, true);
      return;
    }

    cb(new BadRequestException('Unsupported video file type'), false);
  },
} satisfies MulterOptions;

@ApiTags('transcription')
@Controller('transcription')
@UseGuards(SessionGuard)
export class TranscriptionController {
  constructor(private readonly jobsService: TranscriptionJobsService) {}

  @Post('audio')
  @ApiOperation({ summary: 'Upload audio and start transcription' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: {
        file: { type: 'string', format: 'binary' },
        language: { type: 'string' },
      },
    },
  })
  @ApiResponse({ status: 201, description: 'Transcription job queued' })
  @UseInterceptors(FileInterceptor('file', audioUploadOptions))
  upload(
    @UploadedFile() file: Express.Multer.File,
    @Body('language') language: string | undefined,
    @CurrentUser() user: CurrentUserData,
  ) {
    if (!file) {
      throw new BadRequestException('File is required');
    }

    return this.jobsService.createFromUpload(user, file, { language });
  }

  @Post('video')
  @ApiOperation({ summary: 'Upload video and start transcription' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: {
        file: { type: 'string', format: 'binary' },
        language: { type: 'string' },
      },
    },
  })
  @ApiResponse({ status: 201, description: 'Transcription job queued' })
  @UseInterceptors(FileInterceptor('file', videoUploadOptions))
  uploadVideo(
    @UploadedFile() file: Express.Multer.File,
    @Body('language') language: string | undefined,
    @CurrentUser() user: CurrentUserData,
  ) {
    if (!file) {
      throw new BadRequestException('File is required');
    }

    return this.jobsService.createFromVideoUpload(user, file, { language });
  }

  @Get('jobs/:id')
  @ApiOperation({ summary: 'Get transcription job status' })
  getJob(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.jobsService.getJobForUser(id, user);
  }

  @Get('jobs/:id/transcript')
  @ApiOperation({ summary: 'Get transcription result' })
  getTranscript(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.jobsService.getTranscriptForUser(id, user);
  }
}
