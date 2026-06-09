import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';
import { User } from '../../users/entities/user.entity';
import { ExpertPositionOffering } from './expert-position-offering.entity';

@Entity('expert_service_price')
@Unique(['expertId', 'groupServiceId'])
export class ExpertServicePrice {
  @ApiProperty({ format: 'uuid' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  expertId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'expertId' })
  expert: User;

  @Column({ type: 'uuid' })
  groupServiceId: string;

  @ManyToOne(() => ExpertPositionOffering, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'groupServiceId' })
  groupService: ExpertPositionOffering;

  @ApiProperty({
    example: 120000,
    nullable: true,
    description: 'Null means service is unavailable for this expert',
  })
  @Column({ type: 'decimal', precision: 12, scale: 2, nullable: true })
  price: number | null;
}
