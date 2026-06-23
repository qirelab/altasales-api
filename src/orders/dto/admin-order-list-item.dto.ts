import { ApiProperty } from '@nestjs/swagger';
import { OrderStatus } from '../entities/order-status.enum';

export class AdminOrderListItemDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 1 })
  itemsCount: number;

  @ApiProperty({
    example: 'Услуга',
    enum: ['Услуга', 'Документ', 'Подрядчик', 'Пакет услуг', 'Услуга эксперта', 'Услуги эксперта'],
  })
  typeLabel:
    | 'Услуга'
    | 'Документ'
    | 'Подрядчик'
    | 'Пакет услуг'
    | 'Услуга эксперта'
    | 'Услуги эксперта';

  @ApiProperty({ example: 'Внедрение CRM', description: 'Purchased service or package name' })
  name: string;

  @ApiProperty({ example: 'Иван' })
  clientName: string;

  @ApiProperty({ example: 'Петров' })
  clientLastName: string;

  @ApiProperty()
  date: Date;

  @ApiProperty({ example: 50000 })
  amount: number;

  @ApiProperty({ enum: OrderStatus })
  status: OrderStatus;

  @ApiProperty({ example: false })
  contractorChatAccess: boolean;
}
