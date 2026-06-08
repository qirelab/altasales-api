import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMinSize,
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsInt,
  IsOptional,
  IsUUID,
  Min,
  Validate,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

function hasExpert(obj: AddCartItemDto): boolean {
  return Boolean(obj.expertPositionId)
    || Boolean(obj.executorUserId)
    || (Array.isArray(obj.offeringIds) && obj.offeringIds.length > 0);
}

function expertFieldsComplete(obj: AddCartItemDto): boolean {
  return Boolean(obj.expertPositionId)
    && Boolean(obj.executorUserId)
    && Array.isArray(obj.offeringIds)
    && obj.offeringIds.length > 0;
}

@ValidatorConstraint({ name: 'exactlyOneCartProductType', async: false })
class ExactlyOneCartProductTypeConstraint implements ValidatorConstraintInterface {
  validate(_: unknown, args: ValidationArguments): boolean {
    const obj = args.object as AddCartItemDto;
    const variants = [
      Boolean(obj.serviceId),
      Boolean(obj.packageId),
      hasExpert(obj),
    ];
    const picked = variants.filter(Boolean).length;
    if (picked !== 1) return false;
    if (hasExpert(obj) && !expertFieldsComplete(obj)) return false;
    return true;
  }

  defaultMessage(): string {
    return 'Provide exactly one of: serviceId, packageId, '
      + 'or expertPositionId + executorUserId + offeringIds';
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

  @ApiPropertyOptional({ description: 'Expert position ID' })
  @IsOptional()
  @IsUUID()
  expertPositionId?: string;

  @ApiPropertyOptional({ description: 'Selected executor user ID (expert)' })
  @IsOptional()
  @IsUUID()
  executorUserId?: string;

  @ApiPropertyOptional({
    description: 'Selected expert position offering IDs',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  offeringIds?: string[];

  @Validate(ExactlyOneCartProductTypeConstraint)
  private readonly _xorCheck?: boolean;

  @ApiPropertyOptional({ description: 'Quantity', default: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  quantity?: number = 1;
}
