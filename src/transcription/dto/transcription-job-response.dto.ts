import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TranscriptionJobStatus } from '../enums/transcription-job-status.enum';

export class TranscriptionCreateJobResponseDto {
  @ApiProperty()
  jobId: string;

  @ApiProperty({ enum: TranscriptionJobStatus })
  status: TranscriptionJobStatus;

  @ApiProperty()
  createdAt: Date;
}

export class TranscriptionJobResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ enum: TranscriptionJobStatus })
  status: TranscriptionJobStatus;

  @ApiProperty()
  originalFileName: string;

  @ApiProperty()
  mimeType: string;

  @ApiProperty()
  size: number;

  @ApiProperty()
  language: string;

  @ApiProperty()
  provider: string;

  @ApiPropertyOptional({ nullable: true })
  errorCode: string | null;

  @ApiPropertyOptional({ nullable: true })
  safeErrorMessage: string | null;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;

  @ApiPropertyOptional({ nullable: true })
  finishedAt: Date | null;
}
