import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';

export class CategoryFaqItemDto {
  @ApiPropertyOptional({
    example: '550e8400-e29b-41d4-a716-446655440000',
    description: 'FAQ ID (omit for new items on update)',
  })
  @IsOptional()
  @IsUUID()
  id?: string;

  @ApiProperty({ example: 'Сколько длится внедрение?', description: 'FAQ question' })
  @IsString()
  @IsNotEmpty({ message: 'Введите вопрос FAQ' })
  question: string;

  @ApiProperty({
    example: 'Обычно от 2 до 6 недель в зависимости от сложности проекта.',
    description: 'FAQ answer',
  })
  @IsString()
  @IsNotEmpty({ message: 'Введите ответ FAQ' })
  answer: string;
}
