import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';
import { ExpertPositionOffering } from './expert-position-offering.entity';
import { ExpertPositionMember } from './expert-position-member.entity';

@Entity('expert_position')
export class ExpertPosition {
  @ApiProperty({ format: 'uuid' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ example: 'Маркетолог' })
  @Column({ type: 'varchar', length: 120 })
  name: string;

  @ApiProperty({ example: 'MRK' })
  @Column({ type: 'varchar', length: 16, nullable: true })
  iconLabel: string | null;

  @ApiProperty({ example: 'Стратегия, реклама и аналитика продаж' })
  @Column({ type: 'text' })
  description: string;

  @OneToMany(() => ExpertPositionOffering, (offering) => offering.position, { cascade: true })
  offerings: ExpertPositionOffering[];

  @OneToMany(() => ExpertPositionMember, (member) => member.position, { cascade: true })
  members: ExpertPositionMember[];

  @CreateDateColumn()
  createdAt: Date;

  @DeleteDateColumn({ type: 'timestamptz', nullable: true })
  deletedAt: Date | null;
}
