import { ApiProperty } from '@nestjs/swagger';
import { Column, Entity, OneToMany, PrimaryGeneratedColumn } from 'typeorm';
import { Service } from './service.entity';
import { FAQ } from './faq.entity';

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

  @OneToMany(() => Service, (service) => service.category)
  services: Service[];

  @OneToMany(() => FAQ, (faq) => faq.category)
  faqs: FAQ[];
}
