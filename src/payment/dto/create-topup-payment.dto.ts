import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNumber, IsOptional, IsString, Min, MaxLength } from 'class-validator';

export class CreateTopUpPaymentDto {
  @ApiProperty({ example: 1500, description: 'Сумма пополнения баланса' })
  @IsNumber()
  @Min(0.01)
  amount: number;

  @ApiPropertyOptional({
    example: 'Пополнение внутреннего баланса',
    description: 'Комментарий к пополнению',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  description?: string;
}
