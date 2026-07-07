import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class AskChatbotDto {
  @ApiProperty({
    example: 'Сколько стоит пакет CRM Silver?',
    description: 'Free-form question from the user in Russian or English.',
    minLength: 1,
    maxLength: 2000,
  })
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  question!: string;
}
