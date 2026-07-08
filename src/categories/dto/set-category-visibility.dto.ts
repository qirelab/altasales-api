import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

export class SetCategoryVisibilityDto {
  @ApiProperty({
    example: true,
    description: 'Скрыть категорию в публичном каталоге',
  })
  @IsBoolean()
  isHidden: boolean;
}
