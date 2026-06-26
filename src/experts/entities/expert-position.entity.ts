import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { ImageCrop } from '../../common/types/image-crop.type';
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

  @ApiProperty({ example: 'https://cdn.example.com/expert-groups/marketing.png', nullable: true })
  @Column({ type: 'varchar', length: 1024, nullable: true })
  image: string | null;

  @ApiPropertyOptional({
    example: {
      x: 0,
      y: 0,
      zoom: 1.5,
      croppedArea: { x: 120, y: 80, width: 400, height: 400 },
    },
  })
  @Column({ type: 'json', nullable: true })
  imageCrop: ImageCrop | null;

  @OneToMany(() => ExpertPositionOffering, (offering) => offering.position, { cascade: true })
  offerings: ExpertPositionOffering[];

  @OneToMany(() => ExpertPositionMember, (member) => member.position, { cascade: true })
  members: ExpertPositionMember[];

  @CreateDateColumn()
  createdAt: Date;

  @DeleteDateColumn({ type: 'timestamptz', nullable: true })
  deletedAt: Date | null;
}
