import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

const EXPERT_GROUP_SERVICE_MAX_PRICE = 9_999_999_999.99;
const EXPERT_GROUP_SERVICE_MAX_DESCRIPTION_LENGTH = 5000;

export class CreateGroupServiceDto {
  @ApiProperty({ example: 'Консультация' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty({ message: 'Название услуги не может быть пустым' })
  @MaxLength(255, { message: 'Название услуги не должно превышать 255 символов' })
  name: string;

  @ApiProperty({ example: 'Разовая консультация по вопросам должности' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsOptional()
  @MaxLength(EXPERT_GROUP_SERVICE_MAX_DESCRIPTION_LENGTH, {
    message: `Описание услуги не должно превышать ${EXPERT_GROUP_SERVICE_MAX_DESCRIPTION_LENGTH} символов`,
  })
  description?: string | null;

  @ApiProperty({ example: 120000 })
  @Type(() => Number)
  @IsNumber(
    { allowInfinity: false, allowNaN: false, maxDecimalPlaces: 2 },
    { message: 'Цена должна быть корректным числом не более чем с 2 знаками после запятой' },
  )
  @Min(0.01, { message: 'Цена должна быть больше 0' })
  @Max(EXPERT_GROUP_SERVICE_MAX_PRICE, {
    message: `Цена не должна превышать ${EXPERT_GROUP_SERVICE_MAX_PRICE}`,
  })
  defaultPrice: number;

  @ApiPropertyOptional({
    example: false,
    description: 'Whether this offering is payable from the user gift balance',
  })
  @IsBoolean()
  @IsOptional()
  giftEligible?: boolean;
}

export class UpdateGroupServiceDto extends PartialType(CreateGroupServiceDto) {}
