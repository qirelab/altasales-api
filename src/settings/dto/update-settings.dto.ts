import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsNumber, Max, Min } from 'class-validator';

export class UpdateSettingsDto {
  @ApiProperty({
    example: 20,
    description: 'VAT rate percent for cart totals',
  })
  @Type(() => Number)
  @IsNumber(
    { allowInfinity: false, allowNaN: false, maxDecimalPlaces: 2 },
    { message: 'Ставка НДС должна быть числом с максимум 2 знаками после запятой' },
  )
  @Min(0, { message: 'Ставка НДС не может быть меньше 0' })
  @Max(100, { message: 'Ставка НДС не может быть больше 100' })
  vatRatePercent: number;
}
