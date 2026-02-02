import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNumber, IsOptional, IsArray, IsUrl, IsEnum } from 'class-validator';
import { ServiceType } from '../entities/service-type.enum';

export class CreateServiceDto {
  @ApiProperty({
    enum: ServiceType,
    example: ServiceType.Service,
    description: 'Type: Contractor | Service | Document',
  })
  @IsEnum(ServiceType)
  type: ServiceType;

  @ApiProperty({ example: 'Внедрение CRM интеграции', description: 'Service name' })
  @IsString()
  name: string;

  @ApiProperty({ example: 'Настройка и интеграция CRM с вашими системами', description: 'Service description' })
  @IsString()
  description: string;

  @ApiProperty({ example: 'Интеграции', description: 'Service category' })
  @IsString()
  category: string;

  @ApiProperty({ example: 50000, description: 'Service price' })
  @IsNumber()
  price: number;

  @ApiProperty({ example: 'https://example.com/image.jpg', description: 'Service image URL', required: false })
  @IsOptional()
  @IsUrl()
  image?: string;

  @ApiProperty({ example: ['AmoCRM', 'Bitrix24', 'API'], description: 'Array of skills', type: [String], required: false })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  skills?: string[];
}
