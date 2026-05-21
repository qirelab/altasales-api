import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { CheckoutItemDto } from './checkout-item.dto';
import { CheckoutPaymentMethod } from './checkout-payment-method.enum';

export class CheckoutDto {
  @ApiProperty({ example: 125000, description: 'Total order amount' })
  @IsNumber()
  @Min(0.01)
  amount: number;

  @ApiPropertyOptional({ example: 'Нужна интеграция с AmoCRM', description: 'Comment' })
  @IsOptional()
  @IsString()
  comments?: string;

  @ApiProperty({ type: [CheckoutItemDto], description: 'Order items (each item becomes a separate order)' })
  @IsArray()
  @ArrayMinSize(1)
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
