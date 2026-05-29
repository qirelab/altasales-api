import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  JoinColumn,
  JoinTable,
  ManyToMany,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Service } from '../../services/entities/service.entity';
import { Category } from '../../categories/entities/category.entity';

@Entity()
export class ServicePackage {
  @ApiProperty({
    example: '550e8400-e29b-41d4-a716-446655440000',
    description: 'Package ID',
  })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ example: 'CRM Start Pack', description: 'Package name' })
  @Column({ type: 'varchar', length: 255 })
  name: string;

  @ApiProperty({ example: 'Базовый пакет внедрения CRM и автоматизаций', description: 'Package description' })
  @Column({ type: 'text' })
  description: string;

  @ApiProperty({
    example: ['CRM', 'Интеграции', 'Автоматизация'],
    description: 'Package tags',
    type: [String],
  })
  @Column({ type: 'json', default: [] })
  tags: string[];

  @ApiProperty({ example: 'Silver', description: 'Package tier name (free-form string)' })
  @Column({ type: 'varchar', length: 50 })
  packageType: string;

  @ApiProperty({ example: 50000, description: 'Package price' })
  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  price: number;

  @ApiPropertyOptional({ description: 'Category ID for package' })
  @Column({ type: 'uuid', nullable: true })
  categoryId: string | null;

  @ApiPropertyOptional({ type: () => Category, description: 'Linked category entity' })
  @ManyToOne(() => Category, (category) => category.packages, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'categoryId' })
  category: Category | null;

  @ApiPropertyOptional({ type: () => [Service], description: 'Services included in package' })
  @ManyToMany(() => Service, (service) => service.packages, { eager: true })
  @JoinTable({
    name: 'package_services',
    joinColumn: { name: 'packageId', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'serviceId', referencedColumnName: 'id' },
  })
  services: Service[];

  @ApiProperty({ description: 'Creation date' })
  @CreateDateColumn()
  createdAt: Date;

  @DeleteDateColumn({ type: 'timestamptz', nullable: true })
  deletedAt: Date | null;
}
