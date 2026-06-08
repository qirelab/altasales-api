import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';
import { ExpertPositionMember } from './expert-position-member.entity';
import { ExpertPositionOffering } from './expert-position-offering.entity';

@Entity('expert_position_member_offering')
@Unique(['memberId', 'offeringId'])
export class ExpertPositionMemberOffering {
  @ApiProperty({ format: 'uuid' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  memberId: string;

  @ManyToOne(() => ExpertPositionMember, (member) => member.memberOfferings, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'memberId' })
  member: ExpertPositionMember;

  @Column({ type: 'uuid' })
  offeringId: string;

  @ManyToOne(() => ExpertPositionOffering, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'offeringId' })
  offering: ExpertPositionOffering;

  @ApiProperty({ example: 15000, description: 'Executor-specific price for this offering' })
  @Column({ type: 'decimal', precision: 12, scale: 2 })
  price: number;
}
