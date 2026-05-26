import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsOptional,
  IsUUID,
  Min,
  Validate,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

@ValidatorConstraint({ name: 'exactlyOneOfServiceOrPackage', async: false })
class ExactlyOneOfServiceOrPackageConstraint implements ValidatorConstraintInterface {
  validate(_: unknown, args: ValidationArguments): boolean {
    const obj = args.object as AddCartItemDto;
    const hasService = Boolean(obj.serviceId);
    const hasPackage = Boolean(obj.packageId);
    return hasService !== hasPackage;
  }

  defaultMessage(): string {
    return 'Exactly one of serviceId or packageId must be provided';
  }
}

export class AddCartItemDto {
  @ApiPropertyOptional({ description: 'Service ID' })
  @IsOptional()
  @IsUUID()
  serviceId?: string;

  @ApiPropertyOptional({ description: 'Package ID' })
  @IsOptional()
  @IsUUID()
  packageId?: string;

  @Validate(ExactlyOneOfServiceOrPackageConstraint)
  private readonly _xorCheck?: boolean;

  @ApiPropertyOptional({ description: 'Quantity', default: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  quantity?: number = 1;
}
