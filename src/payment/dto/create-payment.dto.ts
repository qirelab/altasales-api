import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsNumber, IsOptional, IsString, IsUUID, Min } from 'class-validator';

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

  @ApiPropertyOptional({
    type: [String],
    description: 'Order IDs to link payment to (batch checkout)',
    example: ['550e8400-e29b-41d4-a716-446655440000'],
  })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  orderIds?: string[];

  @ApiPropertyOptional({
    example: '550e8400-e29b-41d4-a716-446655440000',
    description: 'User ID to link balance top-up payment to',
  })
  @IsOptional()
  @IsString()
  userId?: string;
}
