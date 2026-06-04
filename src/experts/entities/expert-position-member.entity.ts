import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';
import { User } from '../../users/entities/user.entity';
import { ExpertPosition } from './expert-position.entity';
import { ExpertPositionMemberOffering } from './expert-position-member-offering.entity';

@Entity('expert_position_member')
@Unique(['positionId', 'userId'])
export class ExpertPositionMember {
  @ApiProperty({ format: 'uuid' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  positionId: string;

  @ManyToOne(() => ExpertPosition, (position) => position.members, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'positionId' })
  position: ExpertPosition;

  @Column({ type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @OneToMany(() => ExpertPositionMemberOffering, (entry) => entry.member, { cascade: true })
  memberOfferings: ExpertPositionMemberOffering[];

  @CreateDateColumn()
  createdAt: Date;
}
