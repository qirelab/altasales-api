import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { ReferenceAnswerStatus } from '../enums/reference-answer-status.enum';

export enum ReferenceAnswerSortBy {
  CreatedAt = 'createdAt',
  UpdatedAt = 'updatedAt',
  Topic = 'topic',
}

export enum SortDir {
  Asc = 'asc',
  Desc = 'desc',
}

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

export class ListReferenceAnswersDto {
  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({ minimum: 1, maximum: MAX_PAGE_SIZE, default: DEFAULT_PAGE_SIZE })
  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  pageSize: number = DEFAULT_PAGE_SIZE;

  @ApiPropertyOptional({ enum: ReferenceAnswerSortBy })
  @IsOptional()
  @IsEnum(ReferenceAnswerSortBy)
  sortBy: ReferenceAnswerSortBy = ReferenceAnswerSortBy.CreatedAt;

  @ApiPropertyOptional({ enum: SortDir, default: SortDir.Desc })
  @IsOptional()
  @IsEnum(SortDir)
  sortDir: SortDir = SortDir.Desc;

  @ApiPropertyOptional({ description: 'Search across question/answer/topic', maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;

  @ApiPropertyOptional({ description: 'Filter by exact topic', maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  topic?: string;

  @ApiPropertyOptional({ enum: ReferenceAnswerStatus })
  @IsOptional()
  @IsEnum(ReferenceAnswerStatus)
  status?: ReferenceAnswerStatus;
}
