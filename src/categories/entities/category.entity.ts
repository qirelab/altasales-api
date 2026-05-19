import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Column, Entity, OneToMany, PrimaryGeneratedColumn } from 'typeorm';
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

  @ApiPropertyOptional({ example: 'integrations', description: 'Category slug' })
  @Column({ type: 'varchar', length: 120, unique: true, nullable: true })
  slug: string | null;

  @ApiPropertyOptional({
    example: 'Категория услуг по интеграциям CRM, телефонии и внешних API',
    description: 'Category description/content',
  })
  @Column({ type: 'text', nullable: true })
  description: string | null;

  @OneToMany(() => Service, (service) => service.category)
  services: Service[];

  @OneToMany(() => ServicePackage, (servicePackage) => servicePackage.category)
  packages: ServicePackage[];

  @OneToMany(() => FAQ, (faq) => faq.category)
  faqs: FAQ[];
}
