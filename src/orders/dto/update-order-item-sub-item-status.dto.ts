import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import { OrderStatus } from '../entities/order-status.enum';

export class UpdateOrderItemSubItemStatusDto {
  @ApiProperty({ enum: OrderStatus, description: 'Order package sub-item status' })
  @IsEnum(OrderStatus)
  status: OrderStatus;
}
