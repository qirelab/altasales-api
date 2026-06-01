import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { User } from '../../users/entities/user.entity';
import { RecommendationGenerationStatus } from './recommendation-generation-status.enum';

@Entity()
export class RecommendationGenerationJob {
  @ApiProperty({
    example: '550e8400-e29b-41d4-a716-446655440000',
    description: 'Job ID',
  })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ description: 'Target user ID' })
  @Column({ type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @ApiProperty({
    enum: RecommendationGenerationStatus,
    description: 'Generation job status',
  })
  @Column({
    type: 'varchar',
    length: 20,
    default: RecommendationGenerationStatus.Pending,
  })
  status: RecommendationGenerationStatus;

  @ApiPropertyOptional({ description: 'Generation request payload' })
  @Column({ type: 'jsonb', nullable: true })
  request: Record<string, unknown> | null;

  @ApiPropertyOptional({ description: 'Generated recommendations summary' })
  @Column({ type: 'jsonb', nullable: true })
  result: Record<string, unknown>[] | null;

  @ApiPropertyOptional({ description: 'Error message if generation failed' })
  @Column({ type: 'text', nullable: true })
  error: string | null;

  @ApiPropertyOptional({ description: 'When processing started' })
  @Column({ type: 'timestamptz', nullable: true })
  startedAt: Date | null;

  @ApiPropertyOptional({ description: 'When processing completed or failed' })
  @Column({ type: 'timestamptz', nullable: true })
  completedAt: Date | null;

  @ApiProperty({ description: 'Job creation date' })
  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @ApiProperty({ description: 'Job last update date' })
  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
