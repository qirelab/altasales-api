import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsOptional,
  IsUUID,
  Validate,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { RecommendationStatus } from '../entities/recommendation-status.enum';

@ValidatorConstraint({ name: 'exactlyOneOfServiceOrPackageRecommendation', async: false })
class ExactlyOneOfServiceOrPackageRecommendationConstraint implements ValidatorConstraintInterface {
  validate(_: unknown, args: ValidationArguments): boolean {
    const obj = args.object as CreateAdminRecommendationDto;
    const hasService = Boolean(obj.serviceId);
    const hasPackage = Boolean(obj.packageId);
    return hasService !== hasPackage;
  }

  defaultMessage(): string {
    return 'Exactly one of serviceId or packageId must be provided';
  }
}

export class CreateAdminRecommendationDto {
  @ApiProperty({
    example: '550e8400-e29b-41d4-a716-446655440000',
    description: 'Target user ID',
  })
  @IsUUID()
  userId: string;

  @ApiPropertyOptional({
    example: '550e8400-e29b-41d4-a716-446655440000',
    description: 'Service or document ID to recommend',
  })
  @IsOptional()
  @IsUUID()
  serviceId?: string;

  @ApiPropertyOptional({
    example: '550e8400-e29b-41d4-a716-446655440000',
    description: 'Package ID to recommend',
  })
  @IsOptional()
  @IsUUID()
  packageId?: string;

  @Validate(ExactlyOneOfServiceOrPackageRecommendationConstraint)
  private readonly _xorCheck?: boolean;

  @ApiPropertyOptional({
    enum: RecommendationStatus,
    description: 'Initial recommendation status',
    default: RecommendationStatus.Recommended,
  })
  @IsOptional()
  @IsEnum(RecommendationStatus)
  status?: RecommendationStatus;
}
