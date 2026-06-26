import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  OneToOne,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ImageCrop } from '../../common/types/image-crop.type';
import { User } from '../../users/entities/user.entity';

@Entity('expert_profile')
export class ExpertProfile {
  @ApiProperty({ format: 'uuid', description: 'Expert user ID' })
  @PrimaryColumn('uuid')
  userId: string;

  @OneToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @ApiPropertyOptional({ example: 'Анна Соколова — CRM-интегратор' })
  @Column({ type: 'varchar', nullable: true })
  displayName: string | null;

  @ApiPropertyOptional({ example: 'Эксперт по CRM интеграциям' })
  @Column({ type: 'text', nullable: true })
  description: string | null;

  @ApiPropertyOptional({ example: ['AmoCRM', 'Bitrix24'], type: [String] })
  @Column({ type: 'json', default: [] })
  skills: string[];

  @ApiPropertyOptional({ example: 'https://example.com/expert.jpg' })
  @Column({ type: 'varchar', nullable: true })
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

  @ApiPropertyOptional({ example: 5 })
  @Column({ type: 'int', nullable: true })
  experienceYears: number | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
