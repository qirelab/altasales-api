import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';
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

  @ApiPropertyOptional({
    description: 'Short reason why this recommendation matters',
  })
  @IsOptional()
  @IsString()
  rationale?: string;

  @ApiPropertyOptional({
    description: 'Prerequisite recommendation IDs',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  dependencyIds?: string[];

  @ApiPropertyOptional({
    description: 'Diagnostic signals used for the recommendation',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  diagnosticSignals?: string[];
}
