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
import { FeedbackStatus } from './feedback-status.enum';

@Entity('feedback')
@Index('IDX_feedback_userId', ['userId'])
@Index('IDX_feedback_status', ['status'])
@Index('IDX_feedback_createdAt', ['createdAt'])
export class Feedback {
  @ApiProperty({ format: 'uuid' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ format: 'uuid' })
  @Column({ type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @ApiProperty({ example: 'Пользовательский фидбек' })
  @Column({ type: 'text' })
  message: string;

  @ApiPropertyOptional({ example: 5, minimum: 1, maximum: 5 })
  @Column({ type: 'int', nullable: true })
  rating: number | null;

  @ApiProperty({ enum: FeedbackStatus, default: FeedbackStatus.New })
  @Column({ type: 'enum', enum: FeedbackStatus, default: FeedbackStatus.New })
  status: FeedbackStatus;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
