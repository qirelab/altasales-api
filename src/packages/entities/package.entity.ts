import {
  AfterLoad,
  Column,
  CreateDateColumn,
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

  @ApiProperty({
    example: false,
    description: 'Whether the package can be paid with gift balance',
  })
  @Column({ type: 'boolean', default: false })
  giftEligible: boolean;

  @ApiPropertyOptional({ example: 'https://api.example.com/uploads/catalog/packages/uuid.jpeg' })
  @Column({ type: 'varchar', nullable: true })
  image: string | null;

  @ApiPropertyOptional({
    example: 'https://api.example.com/uploads/catalog/packages/uuid-original.jpeg',
    description: 'Original (uncropped) image URL, used for non-destructive re-crop',
  })
  @Column({ type: 'varchar', nullable: true })
  imageOriginal: string | null;

  @ApiPropertyOptional({
    type: () => [Category],
    description: 'Categories the package belongs to (many-to-many)',
  })
  @ManyToMany(() => Category, (category) => category.packages)
  @JoinTable({
    name: 'package_categories',
    joinColumn: { name: 'packageId', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'categoryId', referencedColumnName: 'id' },
  })
  categories: Category[];

  @ApiPropertyOptional({
    type: () => Category,
    description: 'Legacy first category (backward compat, computed from categories[0])',
  })
  category: Category | null;

  @ApiPropertyOptional({ description: 'Legacy first-category ID (backward compat)' })
  categoryId: string | null;

  @AfterLoad()
  protected assignLegacyCategoryFields(): void {
    this.category = this.categories?.[0] ?? null;
    this.categoryId = this.categories?.[0]?.id ?? null;
  }

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

  @Column({ type: 'timestamptz', nullable: true })
  deletedAt: Date | null;
}
