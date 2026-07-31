import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEmail,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { RopTariff } from '../../rop/rop-tariff.enum';
import { ServiceType } from '../entities/service-type.enum';

const SERVICE_MAX_DESCRIPTION_LENGTH = 5000;

export class CreateServiceDto {
  @ApiProperty({
    enum: ServiceType,
    example: ServiceType.Service,
    description: 'Type: Contractor | Service | Document',
  })
  @IsEnum(ServiceType)
  type: ServiceType;

  @ApiProperty({
    example: 'Внедрение CRM интеграции',
    description: 'Service name',
  })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty({ message: 'Название услуги не может быть пустым' })
  @MaxLength(255, {
    message: 'Название услуги не должно превышать 255 символов',
  })
  name: string;

  @ApiProperty({
    example: 'Настройка и интеграция CRM с вашими системами',
    description: 'Service description',
  })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty({ message: 'Описание услуги не может быть пустым' })
  @MaxLength(SERVICE_MAX_DESCRIPTION_LENGTH, {
    message: `Описание услуги не должно превышать ${SERVICE_MAX_DESCRIPTION_LENGTH} символов`,
  })
  description: string;

  @ApiPropertyOptional({
    example: '550e8400-e29b-41d4-a716-446655440000',
    description: 'Category ID for service/document',
  })
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiProperty({ example: 50000, description: 'Service price' })
  @IsNumber()
  price: number;

  @ApiProperty({
    example: 'https://example.com/image.jpg',
    description: 'Service image URL',
    required: false,
  })
  @IsOptional()
  @IsUrl({ require_tld: false, protocols: ['http', 'https'] })
  image?: string;

  @ApiPropertyOptional({
    example: 'https://example.com/image-original.jpg',
    description: 'Original (uncropped) image URL for non-destructive re-crop',
  })
  @IsOptional()
  @IsUrl({ require_tld: false, protocols: ['http', 'https'] })
  imageOriginal?: string;

  @ApiPropertyOptional({
    example: 'https://ropsharing.dev/indicators/interim-report',
    description:
      'External tool URL revealed to the customer after purchase (AI services)',
  })
  @IsOptional()
  @IsUrl({ require_tld: false, protocols: ['http', 'https'] })
  externalUrl?: string;

  @ApiPropertyOptional({
    enum: RopTariff,
    example: RopTariff.Trainer,
    nullable: true,
    description:
      'ROP Sharing tariff for this service (null = do not notify ROP API)',
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsEnum(RopTariff)
  ropTariff?: RopTariff | null;

  @ApiProperty({
    example: ['AmoCRM', 'Bitrix24', 'API'],
    description: 'Array of skills',
    type: [String],
    required: false,
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  skills?: string[];

  @ApiPropertyOptional({
    example: false,
    description: 'Можно ли оплачивать услугу подарочным балансом',
  })
  @IsOptional()
  @IsBoolean()
  giftEligible?: boolean;

  @ApiPropertyOptional({
    example: false,
    description: 'Скрыта ли услуга в публичном каталоге',
  })
  @IsOptional()
  @IsBoolean()
  isHidden?: boolean;

  @ApiPropertyOptional({ description: 'Associated user ID (for contractors)' })
  @IsOptional()
  @IsUUID()
  userId?: string;

  @ApiPropertyOptional({
    example: 'Иван',
    description: 'Contractor first name',
  })
  @IsOptional()
  @IsString()
  contractorName?: string;

  @ApiPropertyOptional({
    example: 'Петров',
    description: 'Contractor last name',
  })
  @IsOptional()
  @IsString()
  contractorLastName?: string;

  @ApiPropertyOptional({
    example: 'contractor@example.com',
    description: 'Contractor email',
  })
  @IsOptional()
  @IsEmail()
  contractorEmail?: string;

  @ApiPropertyOptional({
    example: '+7 (999) 111-22-33',
    description: 'Contractor phone number',
  })
  @IsOptional()
  @IsString()
  contractorPhoneNumber?: string;

  @ApiPropertyOptional({ example: 2500, description: 'Contractor hourly rate' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  contractorRatePerHour?: number;

  @ApiPropertyOptional({
    example: 5,
    description: 'Contractor years of experience',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  contractorExperienceYears?: number;
}
