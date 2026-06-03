import { ApiProperty } from '@nestjs/swagger';
import { AdminOrderListItemDto } from './admin-order-list-item.dto';

export class PaginatedAdminOrdersResponseDto {
  @ApiProperty({ type: [AdminOrderListItemDto] })
  data: AdminOrderListItemDto[];

  @ApiProperty({ example: 42 })
  total: number;

  @ApiProperty({ example: 0 })
  offset: number;

  @ApiProperty({ example: 20 })
  limit: number;
}
