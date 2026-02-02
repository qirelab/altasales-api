import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn } from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';
import { ServiceType } from './service-type.enum';

@Entity()
export class Service {
  @ApiProperty({ example: 1, description: 'Service ID' })
  @PrimaryGeneratedColumn()
  id: number;

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

  @ApiProperty({ example: 'Интеграции', description: 'Service category' })
  @Column()
  category: string;

  @ApiProperty({ example: 50000, description: 'Service price' })
  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  price: number;

  @ApiProperty({ example: 'https://example.com/image.jpg', description: 'Service image URL' })
  @Column({ nullable: true })
  image: string;

  @ApiProperty({
    example: ['AmoCRM', 'Bitrix24', 'API'],
    description: 'Array of skills for the service',
    type: [String],
  })
  @Column({ type: 'json', default: [] })
  skills: string[];

  @ApiProperty({ description: 'Creation date' })
  @CreateDateColumn()
  createdAt: Date;
}
