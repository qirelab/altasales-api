import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import { OrderStatus } from '../entities/order-status.enum';

export class UpdateOrderItemStatusDto {
  @ApiProperty({ enum: OrderStatus, description: 'Order item status' })
  @IsEnum(OrderStatus)
  status: OrderStatus;
}
