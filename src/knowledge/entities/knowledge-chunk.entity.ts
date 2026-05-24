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
import { ApiProperty } from '@nestjs/swagger';
import { KnowledgeDocument } from './knowledge-document.entity';

@Entity()
@Index(['documentId', 'chunkIndex'])
export class KnowledgeChunk {
  @ApiProperty({ description: 'Knowledge chunk ID' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ description: 'Knowledge document ID' })
  @Column({ type: 'uuid' })
  documentId: string;

  @ManyToOne(() => KnowledgeDocument, (document) => document.chunks, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'documentId' })
  document: KnowledgeDocument;

  @ApiProperty({ description: 'Chunk order inside document' })
  @Column({ type: 'integer' })
  chunkIndex: number;

  @ApiProperty({ description: 'Chunk text for retrieval' })
  @Column({ type: 'text' })
  text: string;

  @ApiProperty({ description: 'Chunk character length' })
  @Column({ type: 'integer' })
  charLength: number;

  @ApiProperty({ description: 'Estimated token count', nullable: true })
  @Column({ type: 'integer', nullable: true })
  tokenEstimate: number | null;

  @ApiProperty({ description: 'Safe chunk metadata' })
  @Column({ type: 'jsonb', default: {} })
  metadata: Record<string, unknown>;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
