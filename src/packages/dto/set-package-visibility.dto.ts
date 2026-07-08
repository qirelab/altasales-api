import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

export class SetPackageVisibilityDto {
  @ApiProperty({
    example: true,
    description: 'Скрыть пакет в публичном каталоге',
  })
  @IsBoolean()
  isHidden: boolean;
}
