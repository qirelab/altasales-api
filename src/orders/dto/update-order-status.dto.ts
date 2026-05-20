import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import { OrderStatus } from '../entities/order-status.enum';

export class UpdateOrderStatusDto {
  @ApiProperty({
    enum: OrderStatus,
    description: 'New order status',
    example: OrderStatus.InProgress,
  })
  @IsEnum(OrderStatus)
  status: OrderStatus;
}
