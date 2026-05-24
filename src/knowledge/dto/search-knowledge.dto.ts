import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { KnowledgeBasePurpose } from '../enums/knowledge-base-purpose.enum';

export class SearchKnowledgeDto {
  @ApiProperty({ enum: KnowledgeBasePurpose })
  @IsEnum(KnowledgeBasePurpose)
  purpose: KnowledgeBasePurpose;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  query: string;

  @ApiPropertyOptional({ default: 10, minimum: 1, maximum: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}
