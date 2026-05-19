import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsEnum, IsIn, IsString, IsUUID } from 'class-validator';
import { ServiceType } from '../entities/service-type.enum';

export class GetServicesQueryDto {
  @ApiPropertyOptional({ example: 'CRM', description: 'Search by service name (substring, case-insensitive)' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({
    enum: ServiceType,
    description: 'Filter by type: Contractor | Service | Document',
  })
  @IsOptional()
  @IsEnum(ServiceType)
  type?: ServiceType;

  @ApiPropertyOptional({
    example: '550e8400-e29b-41d4-a716-446655440000',
    description: 'Filter by category ID',
  })
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiPropertyOptional({ example: 'CRM', description: 'Filter by skill (exact match in skills array)' })
  @IsOptional()
  @IsString()
  skill?: string;

  @ApiPropertyOptional({
    enum: ['asc', 'desc'],
    description: 'Sort by price: asc — ascending, desc — descending',
  })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  priceOrder?: 'asc' | 'desc';

  @ApiPropertyOptional({
    enum: ['asc', 'desc'],
    description: 'Sort by creation date: asc — oldest first, desc — newest first',
  })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  dateOrder?: 'asc' | 'desc';
}
