import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import { OrderStatus } from '../entities/order-status.enum';

export class UpdateOrderItemStatusDto {
  @ApiProperty({
    enum: OrderStatus,
    example: OrderStatus.InProgress,
    description: 'New status for the order item',
  })
  @IsEnum(OrderStatus)
  status: OrderStatus;
}
