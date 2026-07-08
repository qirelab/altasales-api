import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

export class SetServiceVisibilityDto {
  @ApiProperty({
    example: true,
    description: 'Скрыть услугу в публичном каталоге',
  })
  @IsBoolean()
  isHidden: boolean;
}
