import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNumber, IsOptional, IsString, IsUUID, Min } from 'class-validator';

export class CheckoutItemDto {
  @ApiProperty({
    example: '550e8400-e29b-41d4-a716-446655440000',
    description: 'Service ID',
  })
  @IsString()
  @IsUUID()
  serviceId: string;

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
