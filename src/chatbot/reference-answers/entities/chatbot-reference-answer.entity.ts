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
import { KnowledgeDocument } from '../../../knowledge/entities/knowledge-document.entity';
import { User } from '../../../users/entities/user.entity';
import { ReferenceAnswerStatus } from '../enums/reference-answer-status.enum';

@Entity('chatbot_reference_answer')
@Index(['status', 'createdAt'])
@Index(['topic'])
export class ChatbotReferenceAnswer {
  @ApiProperty({ description: 'Reference answer ID' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ description: 'Reference question (PII-scanned on save)' })
  @Column({ type: 'text' })
  question: string;

  @ApiProperty({ description: 'Reference answer / manager comment (PII-scanned on save)' })
  @Column({ type: 'text' })
  answer: string;

  @ApiProperty({ description: 'Free-form topic tag', maxLength: 200 })
  @Column({ type: 'varchar', length: 200 })
  topic: string;

  @ApiProperty({ enum: ReferenceAnswerStatus })
  @Column({
    type: 'enum',
    enum: ReferenceAnswerStatus,
    default: ReferenceAnswerStatus.ACTIVE,
  })
  status: ReferenceAnswerStatus;

  @ApiPropertyOptional({ description: 'Linked knowledge document ID', nullable: true })
  @Column({ type: 'uuid', nullable: true })
  sourceDocumentId: string | null;

  @ManyToOne(() => KnowledgeDocument, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'sourceDocumentId' })
  sourceDocument: KnowledgeDocument | null;

  @ApiPropertyOptional({ description: 'Creator user ID', nullable: true })
  @Column({ type: 'uuid', nullable: true })
  createdById: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'createdById' })
  createdBy: User | null;

  // Knowledge document that mirrors this reference in the RAG corpus. When
  // set, AI chat can retrieve the reference via vector search. Null means
  // the entry exists in the admin bank but is not (yet) indexed — either
  // because publish failed or the admin archived it.
  @ApiPropertyOptional({ description: 'Published knowledge document ID', nullable: true })
  @Column({ type: 'uuid', nullable: true })
  publishedDocumentId: string | null;

  @ManyToOne(() => KnowledgeDocument, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'publishedDocumentId' })
  publishedDocument: KnowledgeDocument | null;

  @ApiProperty()
  @CreateDateColumn()
  createdAt: Date;

  @ApiProperty()
  @UpdateDateColumn()
  updatedAt: Date;
}
