import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class CategoryFaqItemDto {
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
