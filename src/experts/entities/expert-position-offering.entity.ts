import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';
import { ExpertPosition } from './expert-position.entity';

@Entity('expert_position_offering')
@Unique(['positionId', 'code'])
export class ExpertPositionOffering {
  @ApiProperty({ format: 'uuid' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  positionId: string;

  @ManyToOne(() => ExpertPosition, (position) => position.offerings, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'positionId' })
  position: ExpertPosition;

  @ApiProperty({ example: 'consultation' })
  @Column({ type: 'varchar', length: 64 })
  code: string;

  @ApiProperty({ example: 'Консультация' })
  @Column({ type: 'varchar', length: 255 })
  name: string;

  @ApiProperty({ example: 'Разовая консультация по вопросам должности' })
  @Column({ type: 'text', nullable: true })
  description: string | null;

  @ApiProperty({ example: 15000 })
  @Column({ type: 'decimal', precision: 12, scale: 2 })
  defaultPrice: number;
}
