import {
  Check,
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
import { Service } from '../../services/entities/service.entity';
import { ServicePackage } from '../../packages/entities/package.entity';
import { Order } from '../../orders/entities/order.entity';
import { RecommendationPriority } from './recommendation-priority.enum';
import { RecommendationSource } from './recommendation-source.enum';
import { RecommendationStatus } from './recommendation-status.enum';

@Entity()
@Index('UQ_recommendation_user_service_not_null', ['userId', 'serviceId'], {
  unique: true,
  where: '"serviceId" IS NOT NULL',
})
@Index('UQ_recommendation_user_package_not_null', ['userId', 'packageId'], {
  unique: true,
  where: '"packageId" IS NOT NULL',
})
@Check('CHK_recommendation_service_xor_package', '("serviceId" IS NOT NULL) <> ("packageId" IS NOT NULL)')
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

  @ApiPropertyOptional({
    example: '550e8400-e29b-41d4-a716-446655440000',
    description: 'Recommended service ID (mutually exclusive with packageId)',
    nullable: true,
  })
  @Column({ type: 'uuid', nullable: true })
  serviceId: string | null;

  @ManyToOne(() => Service, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'serviceId' })
  service: Service | null;

  @ApiPropertyOptional({
    example: '550e8400-e29b-41d4-a716-446655440000',
    description: 'Recommended package ID',
  })
  @Column({ type: 'uuid', nullable: true })
  packageId: string | null;

  @ManyToOne(() => ServicePackage, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'packageId' })
  package: ServicePackage | null;

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

  @ApiProperty({
    enum: RecommendationPriority,
    description: 'Recommendation urgency',
    default: RecommendationPriority.Medium,
  })
  @Column({
    type: 'varchar',
    length: 20,
    default: RecommendationPriority.Medium,
  })
  priority: RecommendationPriority;

  @ApiPropertyOptional({ description: 'Human-readable rationale' })
  @Column({ type: 'text', nullable: true })
  rationale: string | null;

  @ApiProperty({
    description: 'Prerequisite recommendation IDs',
    type: [String],
  })
  @Column({ type: 'jsonb', default: () => '\'[]\'' })
  dependencyIds: string[];

  @ApiProperty({
    description: 'Diagnostic signals that led to this recommendation',
    type: [String],
  })
  @Column({ type: 'jsonb', default: () => '\'[]\'' })
  diagnosticSignals: string[];

  @ApiPropertyOptional({ description: 'When recommendation was AI-generated' })
  @Column({ type: 'timestamptz', nullable: true })
  generatedAt: Date | null;

  @ApiProperty({
    enum: RecommendationSource,
    description: 'Recommendation origin source',
    default: RecommendationSource.Manual,
  })
  @Column({
    type: 'varchar',
    length: 10,
    default: RecommendationSource.Manual,
  })
  source: RecommendationSource;

  @ApiProperty({ description: 'Recommendation creation date' })
  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @ApiProperty({ description: 'Recommendation update date' })
  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
