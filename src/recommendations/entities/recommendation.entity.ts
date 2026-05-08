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
import { Service } from '../../services/entities/service.entity';
import { Order } from '../../orders/entities/order.entity';
import { RecommendationStatus } from './recommendation-status.enum';

@Entity()
export class Recommendation {
  @ApiProperty({
    example: '550e8400-e29b-41d4-a716-446655440000',
    description: 'Recommendation ID',
  })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({
    example: '550e8400-e29b-41d4-a716-446655440000',
    description: 'Client user ID',
  })
  @Column({ type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @ApiProperty({
    example: '550e8400-e29b-41d4-a716-446655440000',
    description: 'Recommended service ID',
  })
  @Column({ type: 'uuid' })
  serviceId: string;

  @ManyToOne(() => Service, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'serviceId' })
  service: Service;

  @ApiPropertyOptional({
    example: '550e8400-e29b-41d4-a716-446655440000',
    description: 'Related order ID when recommendation is purchased',
  })
  @Column({ type: 'uuid', nullable: true })
  orderId: string | null;

  @ManyToOne(() => Order, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'orderId' })
  order: Order | null;

  @ApiProperty({
    enum: RecommendationStatus,
    description: 'Recommendation lifecycle status',
    default: RecommendationStatus.Recommended,
  })
  @Column({
    type: 'varchar',
    length: 20,
    default: RecommendationStatus.Recommended,
  })
  status: RecommendationStatus;

  @ApiProperty({ description: 'Recommendation creation date' })
  @CreateDateColumn()
  createdAt: Date;

  @ApiProperty({ description: 'Recommendation update date' })
  @UpdateDateColumn()
  updatedAt: Date;
}
