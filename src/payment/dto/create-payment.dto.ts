import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNumber, IsString, IsOptional, Min } from 'class-validator';

export class CreatePaymentDto {
  @ApiProperty({ example: 990.5, description: 'Payment amount (OutSum)' })
  @IsNumber()
  @Min(0.01)
  outSum: number;

  @ApiProperty({ example: 'Оплата заказа №12', description: 'Payment description' })
  @IsString()
  description: string;

  @ApiPropertyOptional({ example: 12, description: 'Your order/invoice ID (InvId). If omitted, generated automatically' })
  @IsOptional()
  @IsNumber()
  @Min(1)
  invId?: number;

  @ApiPropertyOptional({
    example: '550e8400-e29b-41d4-a716-446655440000',
    description: 'Order ID to link payment to',
  })
  @IsOptional()
  @IsString()
  orderId?: string;
}
