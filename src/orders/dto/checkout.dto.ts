import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsNumber,
  IsString,
  IsArray,
  ValidateNested,
  Min,
  IsOptional,
  IsDateString,
  IsEnum,
} from 'class-validator';
import { Type } from 'class-transformer';
import { CheckoutItemDto } from './checkout-item.dto';
import { CheckoutPaymentMethod } from './checkout-payment-method.enum';

export class CheckoutDto {
  @ApiProperty({ example: 125000, description: 'Total order amount' })
  @IsNumber()
  @Min(0.01)
  amount: number;

  @ApiProperty({ example: '2025-03-01T00:00:00.000Z', description: 'Desired deadline (ISO)' })
  @IsDateString()
  deadline: string;

  @ApiPropertyOptional({ example: 'Нужна интеграция с AmoCRM', description: 'Comment' })
  @IsOptional()
  @IsString()
  comments?: string;

  @ApiProperty({ type: [CheckoutItemDto], description: 'Order items' })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CheckoutItemDto)
  items: CheckoutItemDto[];

  @ApiPropertyOptional({
    enum: CheckoutPaymentMethod,
    description: 'Способ оплаты: Robokassa или внутренний баланс',
    default: CheckoutPaymentMethod.Robokassa,
  })
  @IsOptional()
  @IsEnum(CheckoutPaymentMethod)
  paymentMethod?: CheckoutPaymentMethod;
}
