import {
  Column,
  DeleteDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';
import { ExpertPosition } from './expert-position.entity';

@Entity('expert_position_offering')
@Unique(['positionId', 'name'])
export class ExpertPositionOffering {
  @ApiProperty({ format: 'uuid' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  positionId: string;

  @ManyToOne(() => ExpertPosition, (position) => position.offerings, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'positionId' })
  position: ExpertPosition;

  @ApiProperty({ example: 'Консультация' })
  @Column({ type: 'varchar', length: 255 })
  name: string;

  @ApiProperty({ example: 'Разовая консультация по вопросам должности' })
  @Column({ type: 'text', nullable: true })
  description: string | null;

  @ApiProperty({ example: 120000, description: 'Default price for newly attached experts' })
  @Column({ type: 'decimal', precision: 12, scale: 2 })
  defaultPrice: number;

  @ApiProperty({
    example: false,
    description: 'Whether this offering is payable from the user gift balance (e.g. consultations)',
  })
  @Column({ type: 'boolean', default: false })
  giftEligible: boolean;

  @DeleteDateColumn({ type: 'timestamptz', nullable: true })
  deletedAt: Date | null;
}
