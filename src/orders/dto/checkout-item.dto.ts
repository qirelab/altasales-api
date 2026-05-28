import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsNumber,
  IsOptional,
  IsUUID,
  Min,
  Validate,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

@ValidatorConstraint({ name: 'exactlyOneOfServiceOrPackageCheckout', async: false })
class ExactlyOneOfServiceOrPackageCheckoutConstraint implements ValidatorConstraintInterface {
  validate(_: unknown, args: ValidationArguments): boolean {
    const obj = args.object as CheckoutItemDto;
    const hasService = Boolean(obj.serviceId);
    const hasPackage = Boolean(obj.packageId);
    return hasService !== hasPackage;
  }

  defaultMessage(): string {
    return 'Exactly one of serviceId or packageId must be provided';
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

  @Validate(ExactlyOneOfServiceOrPackageCheckoutConstraint)
  private readonly _xorCheck?: boolean;

  @ApiPropertyOptional({ example: 10, description: 'Hours (for contractor)' })
  @IsOptional()
  @IsNumber()
  @Min(0.01)
  hours?: number;

  @ApiProperty({ example: 50000, description: 'Line amount' })
  @IsNumber()
  @Min(0.01)
  amount: number;
}
