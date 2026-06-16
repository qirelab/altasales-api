import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMinSize,
  IsArray,
  IsNumber,
  IsOptional,
  IsUUID,
  Min,
  Validate,
  ValidateIf,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

@ValidatorConstraint({ name: 'exactlyOneCheckoutProductRef', async: false })
class ExactlyOneCheckoutProductRefConstraint implements ValidatorConstraintInterface {
  validate(_: unknown, args: ValidationArguments): boolean {
    const obj = args.object as CheckoutItemDto;
    const count = [obj.serviceId, obj.packageId, obj.expertPositionId].filter(Boolean).length;
    return count === 1;
  }

  defaultMessage(): string {
    return 'Exactly one of serviceId, packageId, or expertPositionId must be provided';
  }
}

@ValidatorConstraint({ name: 'expertCheckoutFields', async: false })
class ExpertCheckoutFieldsConstraint implements ValidatorConstraintInterface {
  validate(_: unknown, args: ValidationArguments): boolean {
    const obj = args.object as CheckoutItemDto;
    if (!obj.expertPositionId) {
      return true;
    }
    return Boolean(obj.executorUserId)
      && Array.isArray(obj.offeringIds)
      && obj.offeringIds.length > 0;
  }

  defaultMessage(): string {
    return 'executorUserId and offeringIds are required for expert position checkout';
  }
}

export class CheckoutItemDto {
  @ApiPropertyOptional({
    example: '550e8400-e29b-41d4-a716-446655440000',
    description: 'Service ID',
  })
  @IsOptional()
  @IsUUID()
  serviceId?: string;

  @ApiPropertyOptional({
    example: '550e8400-e29b-41d4-a716-446655440000',
    description: 'Package ID',
  })
  @IsOptional()
  @IsUUID()
  packageId?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Expert position ID (catalog expert checkout)',
  })
  @IsOptional()
  @IsUUID()
  expertPositionId?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Selected executor user ID (required with expertPositionId)',
  })
  @ValidateIf((item: CheckoutItemDto) => Boolean(item.expertPositionId))
  @IsUUID()
  executorUserId?: string;

  @ApiPropertyOptional({
    type: [String],
    description: 'Selected offering IDs for expert position (required with expertPositionId)',
  })
  @ValidateIf((item: CheckoutItemDto) => Boolean(item.expertPositionId))
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  offeringIds?: string[];

  @Validate(ExactlyOneCheckoutProductRefConstraint)
  @Validate(ExpertCheckoutFieldsConstraint)
  private readonly _productRefCheck?: boolean;

  @ApiPropertyOptional({ example: 10, description: 'Hours (for contractor)' })
  @IsOptional()
  @IsNumber()
  @Min(0.01)
  hours?: number;

  @ApiPropertyOptional({ example: 2, description: 'Quantity (for expert position lines)' })
  @IsOptional()
  @IsNumber()
  @Min(1)
  quantity?: number;

  @ApiProperty({ example: 50000, description: 'Line amount' })
  @IsNumber()
  @Min(0.01)
  amount: number;
}
