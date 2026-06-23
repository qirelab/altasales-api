import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { FeedbackStatus } from '../entities/feedback-status.enum';

export type FeedbackSortBy = 'createdAt' | 'rating' | 'status';
export type SortDir = 'asc' | 'desc';

export class FeedbackAdminQueryDto {
  @ApiPropertyOptional({ example: 'спасибо' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ enum: FeedbackStatus })
  @IsOptional()
  @IsEnum(FeedbackStatus)
  status?: FeedbackStatus;

  @ApiPropertyOptional({ example: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ example: 20, default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number = 20;

  @ApiPropertyOptional({ enum: ['createdAt', 'rating', 'status'], default: 'createdAt' })
  @IsOptional()
  @IsIn(['createdAt', 'rating', 'status'])
  sortBy?: FeedbackSortBy = 'createdAt';

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'desc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortDir?: SortDir = 'desc';
}
