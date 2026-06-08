import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsNumber, IsOptional, IsUUID, Min, ValidateNested } from 'class-validator';

export class UpdateGroupPriceCellDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  expertId: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  serviceId: string;

  @ApiProperty({ nullable: true, example: 15000 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  price: number | null;
}

export class BulkUpdateGroupPricesDto {
  @ApiProperty({ type: [UpdateGroupPriceCellDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UpdateGroupPriceCellDto)
  items: UpdateGroupPriceCellDto[];
}

export class SingleUpdateGroupPriceDto {
  @ApiProperty({ nullable: true, example: 15000 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  price: number | null;
}
