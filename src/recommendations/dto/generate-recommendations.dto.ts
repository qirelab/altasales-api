import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';

export class GenerateRecommendationsDto {
  @ApiProperty({
    example: '550e8400-e29b-41d4-a716-446655440000',
    description: 'Target user ID',
  })
  @IsUUID()
  userId: string;

  @ApiPropertyOptional({ description: 'Idempotency key for retrying the same generation job' })
  @IsOptional()
  @IsString()
  idempotencyKey?: string;

  @ApiPropertyOptional({
    description: 'Structured client profile from the platform',
  })
  @IsOptional()
  @IsObject()
  clientProfile?: Record<string, unknown>;

  @ApiPropertyOptional({
    description: 'Free-form diagnostic findings from reports, CRM or calls',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  diagnostics?: string[];

  @ApiPropertyOptional({
    description: 'Maximum number of recommendations to return',
    default: 5,
    minimum: 1,
    maximum: 20,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20)
  limit?: number;

  @ApiPropertyOptional({
    description: 'Persist generated recommendations for the user',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  persist?: boolean;
}