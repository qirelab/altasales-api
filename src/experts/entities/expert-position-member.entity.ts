import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';
import { User } from '../../users/entities/user.entity';
import { ExpertPosition } from './expert-position.entity';

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

  @CreateDateColumn()
  createdAt: Date;
}
