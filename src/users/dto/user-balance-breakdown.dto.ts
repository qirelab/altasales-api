import { ApiProperty } from '@nestjs/swagger';

export class UserBalanceBreakdownResponseDto {
  @ApiProperty({ example: 7500.0, description: 'Текущий баланс (из БД пользователя)' })
  total: number;

  @ApiProperty({
    example: 0,
    description: 'Остаток основного пула (начисления main минус списания с pocket=main)',
  })
  main: number;

  @ApiProperty({
    example: 2500.0,
    description: 'Остаток подарочного пула (начисления gift минус списания с pocket=gift)',
  })
  gift: number;
}
