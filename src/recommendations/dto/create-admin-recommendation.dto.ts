import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  Validate,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { RecommendationPriority } from '../entities/recommendation-priority.enum';
import { RecommendationStatus } from '../entities/recommendation-status.enum';

type RecommendationTargetPayload = {
  serviceId?: string;
  packageId?: string;
};

@ValidatorConstraint({ name: 'exactlyOneRecommendationTarget', async: false })
class ExactlyOneRecommendationTargetConstraint implements ValidatorConstraintInterface {
  validate(_: unknown, args: ValidationArguments): boolean {
    const object = args.object as RecommendationTargetPayload;
    const hasService = Boolean(object.serviceId);
    const hasPackage = Boolean(object.packageId);
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

  @Validate(ExactlyOneRecommendationTargetConstraint)
  private readonly recommendationTarget?: never;

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

  @ApiPropertyOptional({
    enum: RecommendationStatus,
    description: 'Initial recommendation status',
    default: RecommendationStatus.Recommended,
  })
  @IsOptional()
  @IsEnum(RecommendationStatus)
  status?: RecommendationStatus;

  @ApiPropertyOptional({
    enum: RecommendationPriority,
    description: 'Initial urgency level',
    default: RecommendationPriority.Medium,
  })
  @IsOptional()
  @IsEnum(RecommendationPriority)
  priority?: RecommendationPriority;

  @ApiPropertyOptional({
    description: 'Short reason why this recommendation matters',
  })
  @IsOptional()
  @IsString()
  rationale?: string;

  @ApiPropertyOptional({
    description: 'Prerequisite recommendation IDs',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  dependencyIds?: string[];

  @ApiPropertyOptional({
    description: 'Diagnostic signals used for the recommendation',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  diagnosticSignals?: string[];
}
