import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Column, Entity, ManyToMany, OneToMany, PrimaryGeneratedColumn } from 'typeorm';
import { Service } from '../../services/entities/service.entity';
import { FAQ } from '../../services/entities/faq.entity';
import { ServicePackage } from '../../packages/entities/package.entity';

@Entity()
export class Category {
  @ApiProperty({
    example: '550e8400-e29b-41d4-a716-446655440000',
    description: 'Category ID',
  })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ example: 'Интеграции', description: 'Category name' })
  @Column({ type: 'varchar', length: 120, unique: true })
  name: string;

  @ApiProperty({ example: 'integrations', description: 'Category slug' })
  @Column({ type: 'varchar', length: 120, unique: true, nullable: true })
  slug: string;

  @ApiPropertyOptional({
    example: 'Категория услуг по интеграциям CRM, телефонии и внешних API',
    description: 'Category description/content',
  })
  @Column({ type: 'text', nullable: true })
  description: string | null;

  @ApiProperty({
    example: 0,
    description: 'Manual display order (lower = earlier)',
  })
  @Column({ type: 'int', default: 0 })
  sortOrder: number;

  @OneToMany(() => Service, (service) => service.category)
  services: Service[];

  @ManyToMany(() => ServicePackage, (servicePackage) => servicePackage.categories)
  packages: ServicePackage[];

  @OneToMany(() => FAQ, (faq) => faq.category)
  faqs: FAQ[];
}
