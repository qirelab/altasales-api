import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsNumber, IsOptional, IsString, IsUUID, Min } from 'class-validator';

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

  @ApiProperty({ example: 'Silver', description: 'Package tier name (free-form string)' })
  @IsString()
  packageType: string;

  @ApiProperty({ example: 50000, description: 'Package price' })
  @IsNumber()
  @Min(0)
  price: number;

  @ApiPropertyOptional({
    example: false,
    description: 'Можно ли оплачивать пакет подарочным балансом',
  })
  @IsOptional()
  @IsBoolean()
  giftEligible?: boolean;

  @ApiPropertyOptional({
    example: 'https://api.example.com/uploads/catalog/packages/uuid.jpeg',
    description: 'Package image URL',
  })
  @IsOptional()
  @IsString()
  image?: string | null;

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
