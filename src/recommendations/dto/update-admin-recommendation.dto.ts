import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsEnum, IsOptional, IsUUID } from 'class-validator';
import { RecommendationStatus } from '../entities/recommendation-status.enum';

export class UpdateAdminRecommendationDto {
  @ApiPropertyOptional({
    example: '550e8400-e29b-41d4-a716-446655440000',
    description: 'New service or document ID',
  })
  @IsOptional()
  @IsUUID()
  serviceId?: string;

  @ApiPropertyOptional({
    example: '550e8400-e29b-41d4-a716-446655440000',
    nullable: true,
    description: 'Linked order ID',
  })
  @IsOptional()
  @IsUUID()
  orderId?: string;

  @ApiPropertyOptional({
    enum: RecommendationStatus,
    description: 'Recommendation status',
  })
  @IsOptional()
  @IsEnum(RecommendationStatus)
  status?: RecommendationStatus;

  @ApiPropertyOptional({
    description: 'Prerequisite recommendation IDs',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  dependencyIds?: string[];
}
