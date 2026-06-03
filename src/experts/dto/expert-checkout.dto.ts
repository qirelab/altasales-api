import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';
import { CheckoutPaymentMethod } from '../../orders/dto/checkout-payment-method.enum';

export class ExpertCheckoutDto {
  @ApiProperty({ format: 'uuid', description: 'Expert position (role group) ID' })
  @IsUUID()
  positionId: string;

  @ApiProperty({ format: 'uuid', description: 'Selected executor (expert user) ID' })
  @IsUUID()
  executorUserId: string;

  @ApiProperty({
    type: [String],
    description: 'Selected position offering IDs (services with default prices)',
  })
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  offeringIds: string[];

  @ApiPropertyOptional({ example: 'Нужна консультация по запуску рекламы' })
  @IsOptional()
  @IsString()
  comments?: string;

  @ApiPropertyOptional({
    enum: CheckoutPaymentMethod,
    default: CheckoutPaymentMethod.Robokassa,
  })
  @IsOptional()
  @IsEnum(CheckoutPaymentMethod)
  paymentMethod?: CheckoutPaymentMethod;
}
