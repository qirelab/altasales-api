import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNumber, IsOptional, Min } from 'class-validator';

export class CheckoutItemDto {
  @ApiProperty({ example: 1, description: 'Service ID' })
  @IsNumber()
  @Min(1)
  serviceId: number;

  @ApiPropertyOptional({ example: 10, description: 'Hours (for contractor)' })
  @IsOptional()
  @IsNumber()
  @Min(0.01)
  hours?: number;

  @ApiProperty({ example: 50000, description: 'Line amount' })
  @IsNumber()
  @Min(0.01)
  amount: number;
}
