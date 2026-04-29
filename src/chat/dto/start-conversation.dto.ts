import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';

export class StartConversationDto {
  @ApiProperty({
    example: '550e8400-e29b-41d4-a716-446655440000',
    description: 'Recipient user ID',
  })
  @IsUUID()
  recipientId: string;

  @ApiPropertyOptional({
    example: '550e8400-e29b-41d4-a716-446655440000',
    description: 'Order ID for order-specific conversation',
  })
  @IsOptional()
  @IsUUID()
  orderId?: string;
}
