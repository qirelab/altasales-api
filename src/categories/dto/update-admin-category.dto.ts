import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { UpdateCategoryFaqItemDto } from './update-category-faq-item.dto';

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
  @Matches(/^[a-z0-9-]+$/, { message: 'Slug может содержать только строчные латинские буквы, цифры и дефис' })
  slug?: string;

  @ApiPropertyOptional({
    example: 'Категория услуг по интеграциям',
    description: 'Category description/content (null to clear)',
  })
  @IsOptional()
  @IsString()
  description?: string | null;

  @ApiPropertyOptional({
    type: [UpdateCategoryFaqItemDto],
    description: 'Full FAQ list for the category (replaces existing items)',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UpdateCategoryFaqItemDto)
  faqs?: UpdateCategoryFaqItemDto[];
}
