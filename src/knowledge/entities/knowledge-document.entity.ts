import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { KnowledgeBasePurpose } from '../enums/knowledge-base-purpose.enum';
import { KnowledgeDocumentStatus } from '../enums/knowledge-document-status.enum';
import { KnowledgeSourceType } from '../enums/knowledge-source-type.enum';
import { KnowledgeChunk } from './knowledge-chunk.entity';
import { KnowledgeIndexJob } from './knowledge-index-job.entity';

@Entity()
@Index(['purpose', 'status', 'createdAt'])
export class KnowledgeDocument {
  @ApiProperty({ description: 'Knowledge document ID' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiPropertyOptional({ description: 'Document title', nullable: true })
  @Column({ type: 'varchar', length: 255, nullable: true })
  title: string | null;

  @ApiProperty({ enum: KnowledgeBasePurpose })
  @Column({ type: 'enum', enum: KnowledgeBasePurpose })
  purpose: KnowledgeBasePurpose;

  @ApiProperty({ enum: KnowledgeSourceType })
  @Column({ type: 'enum', enum: KnowledgeSourceType })
  sourceType: KnowledgeSourceType;

  @ApiProperty({ description: 'Original uploaded file name' })
  @Column({ type: 'varchar', length: 255 })
  originalFileName: string;

  @ApiPropertyOptional({ description: 'Normalized source URL', nullable: true })
  @Column({ type: 'varchar', length: 2048, nullable: true })
  sourceUrl: string | null;

  @ApiProperty({ description: 'MIME type' })
  @Column({ type: 'varchar', length: 150 })
  mimeType: string;

  @ApiProperty({ description: 'File size in bytes' })
  @Column({ type: 'integer' })
  size: number;

  @ApiProperty({ enum: KnowledgeDocumentStatus })
  @Column({
    type: 'enum',
    enum: KnowledgeDocumentStatus,
    default: KnowledgeDocumentStatus.PENDING,
  })
  status: KnowledgeDocumentStatus;

  @ApiPropertyOptional({ nullable: true })
  @Column({ type: 'varchar', length: 100, nullable: true })
  errorCode: string | null;

  @ApiPropertyOptional({ nullable: true })
  @Column({ type: 'varchar', length: 255, nullable: true })
  safeErrorMessage: string | null;

  @ApiProperty({ description: 'Indexed chunks count' })
  @Column({ type: 'integer', default: 0 })
  chunksCount: number;

  @ApiProperty({ description: 'Safe document metadata' })
  @Column({ type: 'jsonb', default: {} })
  metadata: Record<string, unknown>;

  @ApiProperty({ description: 'Creation date' })
  @CreateDateColumn()
  createdAt: Date;

  @ApiProperty({ description: 'Update date' })
  @UpdateDateColumn()
  updatedAt: Date;

  @OneToMany(() => KnowledgeChunk, (chunk) => chunk.document, {
    cascade: true,
  })
  chunks: KnowledgeChunk[];

  @OneToMany(() => KnowledgeIndexJob, (job) => job.document, {
    cascade: true,
  })
  jobs: KnowledgeIndexJob[];
}
