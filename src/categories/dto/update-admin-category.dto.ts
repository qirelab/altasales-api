import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { CategoryFaqItemDto } from './category-faq-item.dto';

export class UpdateAdminCategoryDto {
  @ApiPropertyOptional({ example: 'Интеграции', description: 'Category name' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional({ example: 'integrations', description: 'Unique category slug' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  slug?: string;

  @ApiPropertyOptional({
    example: 'Категория услуг по интеграциям',
    description: 'Category description/content (null to clear)',
  })
  @IsOptional()
  @IsString()
  description?: string | null;

  @ApiPropertyOptional({
    type: [CategoryFaqItemDto],
    description: 'Full FAQ list for the category (replaces existing items)',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CategoryFaqItemDto)
  faqs?: CategoryFaqItemDto[];
}
