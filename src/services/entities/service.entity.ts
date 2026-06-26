import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  ManyToMany,
} from 'typeorm';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Category } from '../../categories/entities/category.entity';
import { ServicePackage } from '../../packages/entities/package.entity';
import { User } from '../../users/entities/user.entity';
import { ServiceType } from './service-type.enum';

@Entity()
export class Service {
  @ApiProperty({
    example: '550e8400-e29b-41d4-a716-446655440000',
    description: 'Service ID',
  })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({
    enum: ServiceType,
    example: ServiceType.Service,
    description: 'Type: Contractor | Service | Document',
  })
  @Column({ type: 'varchar', length: 50 })
  type: ServiceType;

  @ApiProperty({ example: 'Внедрение CRM интеграции', description: 'Service name' })
  @Column()
  name: string;

  @ApiProperty({ example: 'Настройка и интеграция CRM с вашими системами', description: 'Service description' })
  @Column({ type: 'text' })
  description: string;

  @ApiPropertyOptional({ description: 'Category ID for service/document' })
  @Column({ type: 'uuid', nullable: true })
  categoryId: string | null;

  @ApiPropertyOptional({ type: () => Category, description: 'Linked category entity' })
  @ManyToOne(() => Category, (category) => category.services, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'categoryId' })
  category: Category | null;

  @ApiProperty({ example: 50000, description: 'Service price' })
  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  price: number;

  @ApiProperty({ example: 'https://example.com/image.jpg', description: 'Service image URL (cropped preview)' })
  @Column({ type: 'varchar', nullable: true })
  image: string | null;

  @ApiPropertyOptional({
    example: 'https://example.com/image-original.jpg',
    description: 'Service original (uncropped) image URL, used for non-destructive re-crop',
  })
  @Column({ type: 'varchar', nullable: true })
  imageOriginal: string | null;

  @ApiProperty({
    example: ['AmoCRM', 'Bitrix24', 'API'],
    description: 'Array of skills for the service',
    type: [String],
  })
  @Column({ type: 'json', default: [] })
  skills: string[];

  @ApiProperty({
    example: false,
    description: 'Whether the service can be paid with gift balance',
  })
  @Column({ type: 'boolean', default: false })
  giftEligible: boolean;

  @ApiPropertyOptional({ example: 2500, description: 'Contractor hourly rate' })
  @Column({ type: 'decimal', precision: 12, scale: 2, nullable: true })
  contractorRatePerHour: number | null;

  @ApiPropertyOptional({ example: 5, description: 'Contractor years of experience' })
  @Column({ type: 'int', nullable: true })
  contractorExperienceYears: number | null;

  @ApiPropertyOptional({ description: 'Associated user ID (for contractors)' })
  @Column({ type: 'uuid', nullable: true })
  userId: string | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'userId' })
  user: User;

  @ApiProperty({ description: 'Creation date' })
  @CreateDateColumn()
  createdAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  deletedAt: Date | null;

  @ApiPropertyOptional({
    description: 'Packages containing this service',
    type: () => [ServicePackage],
  })
  @ManyToMany(() => ServicePackage, (servicePackage) => servicePackage.services)
  packages: ServicePackage[];
}
