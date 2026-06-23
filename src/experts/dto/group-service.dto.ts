import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsNotEmpty, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class CreateGroupServiceDto {
  @ApiProperty({ example: 'Консультация' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ example: 'Разовая консультация по вопросам должности' })
  @IsString()
  @IsOptional()
  description?: string | null;

  @ApiProperty({ example: 120000 })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
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
