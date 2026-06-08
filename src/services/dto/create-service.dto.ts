import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsNumber, IsOptional, IsArray, IsUrl, IsEnum, IsUUID, IsInt, Min, IsEmail } from 'class-validator';
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

  @ApiPropertyOptional({
    example: '550e8400-e29b-41d4-a716-446655440000',
    description: 'Category ID for service/document',
  })
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiProperty({ example: 50000, description: 'Service price' })
  @IsNumber()
  price: number;

  @ApiProperty({ example: 'https://example.com/image.jpg', description: 'Service image URL', required: false })
  @IsOptional()
  @IsUrl({ require_tld: false, protocols: ['http', 'https'] })
  image?: string;

  @ApiProperty({ example: ['AmoCRM', 'Bitrix24', 'API'], description: 'Array of skills', type: [String], required: false })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  skills?: string[];

  @ApiPropertyOptional({ description: 'Associated user ID (for contractors)' })
  @IsOptional()
  @IsUUID()
  userId?: string;

  @ApiPropertyOptional({ example: 'Иван', description: 'Contractor first name' })
  @IsOptional()
  @IsString()
  contractorName?: string;

  @ApiPropertyOptional({ example: 'Петров', description: 'Contractor last name' })
  @IsOptional()
  @IsString()
  contractorLastName?: string;

  @ApiPropertyOptional({ example: 'contractor@example.com', description: 'Contractor email' })
  @IsOptional()
  @IsEmail()
  contractorEmail?: string;

  @ApiPropertyOptional({ example: '+7 (999) 111-22-33', description: 'Contractor phone number' })
  @IsOptional()
  @IsString()
  contractorPhoneNumber?: string;

  @ApiPropertyOptional({ example: 2500, description: 'Contractor hourly rate' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  contractorRatePerHour?: number;

  @ApiPropertyOptional({ example: 5, description: 'Contractor years of experience' })
  @IsOptional()
  @IsInt()
  @Min(0)
  contractorExperienceYears?: number;
}
