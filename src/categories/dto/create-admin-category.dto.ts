import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { CategoryFaqItemDto } from './category-faq-item.dto';

export class CreateAdminCategoryDto {
  @ApiProperty({ example: 'Интеграции', description: 'Category name' })
  @IsString()
  @IsNotEmpty({ message: 'Введите название категории' })
  @MaxLength(120)
  name: string;

  @ApiProperty({ example: 'integrations', description: 'Unique category slug (latin, lowercase)' })
  @IsString()
  @IsNotEmpty({ message: 'Введите slug категории' })
  @MaxLength(120)
  slug: string;

  @ApiPropertyOptional({
    example: 'Категория услуг по интеграциям CRM, телефонии и внешних API',
    description: 'Category description/content',
  })
  @IsOptional()
  @IsString()
  description?: string | null;

  @ApiPropertyOptional({
    type: [CategoryFaqItemDto],
    description: 'FAQ items for the category',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CategoryFaqItemDto)
  faqs?: CategoryFaqItemDto[];
}
