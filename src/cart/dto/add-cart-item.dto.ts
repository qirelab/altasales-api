import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsUUID, Min } from 'class-validator';

export class AddCartItemDto {
  @ApiProperty({ description: 'Service ID' })
  @IsUUID()
  serviceId: string;

  @ApiPropertyOptional({ description: 'Quantity', default: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  quantity?: number = 1;
}
