import { ApiProperty } from '@nestjs/swagger';

export class UserBalanceBreakdownResponseDto {
  @ApiProperty({ example: 7500.0, description: 'Текущий баланс (из БД пользователя)' })
  total: number;

  @ApiProperty({
    example: 2500.0,
    description:
      'Остаток «основного» пула: total − gift. Списания учитываются как сначала из подарочных начислений.',
  })
  main: number;

  @ApiProperty({
    example: 5000.0,
    description: 'Остаток подарочных начислений после списаний (gift-first)',
  })
  gift: number;
}
