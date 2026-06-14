import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { User } from '../../users/entities/user.entity';
import { TranscriptionJobStatus } from '../enums/transcription-job-status.enum';

export type TranscriptSegment = {
  startMs: number;
  endMs: number;
  text: string;
  speaker?: string | null;
  confidence?: number | null;
};

@Entity()
@Index(['userId', 'createdAt'])
@Index(['status', 'createdAt'])
export class TranscriptionJob {
  @ApiProperty({ description: 'Transcription job ID' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ description: 'Owner user ID' })
  @Column({ type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @ApiProperty({ enum: TranscriptionJobStatus })
  @Column({
    type: 'enum',
    enum: TranscriptionJobStatus,
    default: TranscriptionJobStatus.QUEUED,
  })
  status: TranscriptionJobStatus;

  @ApiProperty({ description: 'Original uploaded file name' })
  @Column({ type: 'varchar', length: 255 })
  originalFileName: string;

  @ApiProperty({ description: 'MIME type' })
  @Column({ type: 'varchar', length: 150 })
  mimeType: string;

  @ApiProperty({ description: 'File size in bytes' })
  @Column({ type: 'integer' })
  size: number;

  @ApiProperty({ description: 'Recognition language' })
  @Column({ type: 'varchar', length: 20 })
  language: string;

  @ApiProperty({ description: 'Transcription provider' })
  @Column({ type: 'varchar', length: 50, default: 'yandex_speechkit' })
  provider: string;

  @ApiPropertyOptional({ nullable: true })
  @Column({ type: 'varchar', length: 255, nullable: true })
  externalOperationId: string | null;

  @ApiPropertyOptional({ nullable: true })
  @Column({ type: 'varchar', length: 512, nullable: true })
  objectStorageKey: string | null;

  @ApiPropertyOptional({ nullable: true })
  @Column({ type: 'text', nullable: true })
  text: string | null;

  @ApiProperty({ description: 'Normalized transcript segments' })
  @Column({ type: 'jsonb', default: [] })
  segments: TranscriptSegment[];

  @ApiPropertyOptional({ nullable: true })
  @Column({ type: 'varchar', length: 100, nullable: true })
  errorCode: string | null;

  @ApiPropertyOptional({ nullable: true })
  @Column({ type: 'varchar', length: 255, nullable: true })
  safeErrorMessage: string | null;

  @ApiPropertyOptional({ nullable: true })
  @Column({ type: 'timestamptz', nullable: true })
  startedAt: Date | null;

  @ApiPropertyOptional({ nullable: true })
  @Column({ type: 'timestamptz', nullable: true })
  finishedAt: Date | null;

  @ApiProperty({ description: 'Creation date' })
  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @ApiProperty({ description: 'Update date' })
  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
