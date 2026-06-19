import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  Min,
} from 'class-validator';

export class UpdateExpertProfileDto {
  @ApiPropertyOptional({ example: 'Эксперт по CRM интеграциям' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ example: ['AmoCRM', 'Bitrix24'], type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  skills?: string[];

  @ApiPropertyOptional({ example: 'https://example.com/expert.jpg' })
  @IsOptional()
  @IsUrl({ require_tld: false, protocols: ['http', 'https'] })
  image?: string | null;

  @ApiPropertyOptional({ example: 5, minimum: 0, maximum: 99 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(99)
  experienceYears?: number;
}
