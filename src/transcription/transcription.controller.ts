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
import { extname } from 'path';
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
const SUPPORTED_AUDIO_TYPES = new Map([
  ['audio/mpeg', new Set(['.mp3'])],
  ['audio/wav', new Set(['.wav'])],
  ['audio/x-wav', new Set(['.wav'])],
  ['audio/ogg', new Set(['.ogg'])],
]);

function getMaxAudioSizeBytes(): number {
  const parsed = Number(process.env.TRANSCRIPTION_MAX_AUDIO_SIZE_MB);
  const sizeMb = Number.isFinite(parsed) && parsed > 0
    ? parsed
    : DEFAULT_MAX_AUDIO_SIZE_MB;
  return sizeMb * 1024 * 1024;
}

export function isSupportedTranscriptionAudioFile(file: UploadFileMetadata): boolean {
  const extension = extname(file.originalname).toLowerCase();
  return SUPPORTED_AUDIO_TYPES.get(file.mimetype)?.has(extension) ?? false;
}

const uploadOptions = {
  limits: { fileSize: getMaxAudioSizeBytes() },
  fileFilter: (_req, file, cb) => {
    if (isSupportedTranscriptionAudioFile(file)) {
      cb(null, true);
      return;
    }

    cb(new BadRequestException('Unsupported audio file type'), false);
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
  @UseInterceptors(FileInterceptor('file', uploadOptions))
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
