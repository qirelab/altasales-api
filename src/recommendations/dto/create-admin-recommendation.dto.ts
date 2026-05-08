import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import { RecommendationStatus } from '../entities/recommendation-status.enum';

export class CreateAdminRecommendationDto {
  @ApiProperty({
    example: '550e8400-e29b-41d4-a716-446655440000',
    description: 'Target user ID',
  })
  @IsUUID()
  userId: string;

  @ApiProperty({
    example: '550e8400-e29b-41d4-a716-446655440000',
    description: 'Service or document ID to recommend',
  })
  @IsUUID()
  serviceId: string;

  @ApiPropertyOptional({
    enum: RecommendationStatus,
    description: 'Initial recommendation status',
    default: RecommendationStatus.Recommended,
  })
  @IsOptional()
  @IsEnum(RecommendationStatus)
  status?: RecommendationStatus;
}
