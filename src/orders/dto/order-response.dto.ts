import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { OrderStatus } from '../entities/order-status.enum';

export class OrderResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  userId: string;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty({ example: 50000 })
  amount: number;

  @ApiProperty({ enum: OrderStatus })
  status: OrderStatus;

  @ApiPropertyOptional({ nullable: true })
  deadline: Date | null;

  @ApiPropertyOptional({ nullable: true })
  comments?: string | null;

  @ApiProperty({ example: false })
  contractorChatAccess: boolean;

  @ApiProperty({
    example: 'Внедрение CRM',
    description: 'Purchased service or package name (flat field for listings)',
  })
  name: string;

  @ApiPropertyOptional({ description: 'Order line item with service/package details' })
  item?: unknown;
}
