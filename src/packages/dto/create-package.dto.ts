import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsEnum, IsNumber, IsOptional, IsString, IsUUID, Min } from 'class-validator';
import { PackageType } from '../entities/package-type.enum';

export class CreatePackageDto {
  @ApiProperty({ example: 'CRM Start Pack', description: 'Package name' })
  @IsString()
  name: string;

  @ApiProperty({ example: 'Базовый пакет внедрения CRM и автоматизаций', description: 'Package description' })
  @IsString()
  description: string;

  @ApiPropertyOptional({
    example: ['CRM', 'Интеграции', 'Автоматизация'],
    description: 'Package tags',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @ApiProperty({
    enum: PackageType,
    example: PackageType.Economy,
    description: 'Package tier',
  })
  @IsEnum(PackageType)
  packageType: PackageType;

  @ApiProperty({ example: 50000, description: 'Package price' })
  @IsNumber()
  @Min(0)
  price: number;

  @ApiPropertyOptional({
    example: '550e8400-e29b-41d4-a716-446655440000',
    description: 'Category ID for package',
  })
  @IsOptional()
  @IsUUID()
  categoryId?: string | null;

  @ApiPropertyOptional({
    type: [String],
    description: 'List of service IDs included in package',
    example: ['550e8400-e29b-41d4-a716-446655440000'],
  })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  serviceIds?: string[];
}
