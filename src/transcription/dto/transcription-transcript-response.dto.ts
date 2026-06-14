import { ApiProperty } from '@nestjs/swagger';
import type { TranscriptSegment } from '../entities/transcription-job.entity';
import { TranscriptionJobStatus } from '../enums/transcription-job-status.enum';

export class TranscriptionTranscriptResponseDto {
  @ApiProperty()
  jobId: string;

  @ApiProperty({ enum: TranscriptionJobStatus })
  status: TranscriptionJobStatus;

  @ApiProperty()
  text: string;

  @ApiProperty()
  segments: TranscriptSegment[];
}
