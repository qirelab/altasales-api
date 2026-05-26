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
import { KnowledgeIndexJobStatus } from '../enums/knowledge-index-job-status.enum';
import { KnowledgeIndexStage } from '../enums/knowledge-index-stage.enum';
import { KnowledgeDocument } from './knowledge-document.entity';

@Entity()
@Index(['documentId', 'status'])
export class KnowledgeIndexJob {
  @ApiProperty({ description: 'Knowledge index job ID' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ description: 'Knowledge document ID' })
  @Column({ type: 'uuid' })
  documentId: string;

  @ManyToOne(() => KnowledgeDocument, (document) => document.jobs, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'documentId' })
  document: KnowledgeDocument;

  @ApiProperty({ enum: KnowledgeIndexJobStatus })
  @Column({
    type: 'enum',
    enum: KnowledgeIndexJobStatus,
    default: KnowledgeIndexJobStatus.PENDING,
  })
  status: KnowledgeIndexJobStatus;

  @ApiProperty({ enum: KnowledgeIndexStage })
  @Column({
    type: 'enum',
    enum: KnowledgeIndexStage,
    default: KnowledgeIndexStage.PENDING,
  })
  stage: KnowledgeIndexStage;

  @ApiPropertyOptional({ nullable: true })
  @Column({ type: 'varchar', length: 100, nullable: true })
  errorCode: string | null;

  @ApiPropertyOptional({ nullable: true })
  @Column({ type: 'varchar', length: 255, nullable: true })
  safeErrorMessage: string | null;

  @ApiProperty({ description: 'Total chunks count' })
  @Column({ type: 'integer', default: 0 })
  chunksTotal: number;

  @ApiProperty({ description: 'Embedded chunks count' })
  @Column({ type: 'integer', default: 0 })
  chunksEmbedded: number;

  @ApiPropertyOptional({ nullable: true })
  @Column({ type: 'timestamp', nullable: true })
  startedAt: Date | null;

  @ApiPropertyOptional({ nullable: true })
  @Column({ type: 'timestamp', nullable: true })
  finishedAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
