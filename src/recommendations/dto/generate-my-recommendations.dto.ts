import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsInt,
  MaxLength,
  IsObject,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class GenerateMyRecommendationsDto {
  @ApiPropertyOptional({ description: 'Idempotency key for retrying the same generation job' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  idempotencyKey?: string;

  @ApiPropertyOptional({
    description: 'Structured client profile from onboarding or platform data',
  })
  @IsOptional()
  @IsObject()
  clientProfile?: Record<string, unknown>;

  @ApiPropertyOptional({
    description: 'Free-form diagnostic findings from onboarding, CRM or calls',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  diagnostics?: string[];

  @ApiPropertyOptional({
    description: 'Maximum number of recommendations after package compaction',
    minimum: 1,
    maximum: 20,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20)
  limit?: number;

  @ApiPropertyOptional({
    description: 'Persist generated recommendations for the current user',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  persist?: boolean;
}
