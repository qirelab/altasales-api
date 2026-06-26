import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsEmail,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { ImageCropDto } from '../../common/dto/image-crop.dto';

export class CreateAdminExpertMemberDto {
  @ApiProperty({ example: 'Анна' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ example: 'Соколова' })
  @IsString()
  @IsNotEmpty()
  lastName: string;

  @ApiProperty({ example: 'anna@example.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: '+79991234567' })
  @IsString()
  phoneNumber: string;

  @ApiProperty({ example: 'secret123', minLength: 6 })
  @IsString()
  @MinLength(6)
  password: string;

  @ApiProperty({ example: 5, minimum: 0, maximum: 99 })
  @IsInt()
  @Min(0)
  @Max(99)
  experienceYears: number;

  @ApiProperty({ example: ['AmoCRM', 'Bitrix24'], type: [String] })
  @IsArray()
  @IsString({ each: true })
  skills: string[];

  @ApiProperty({ example: 'Эксперт по CRM интеграциям' })
  @IsString()
  description: string;

  @ApiPropertyOptional({ example: 'https://example.com/expert.jpg' })
  @IsOptional()
  @IsUrl({ require_tld: false, protocols: ['http', 'https'] })
  image?: string;

  @ApiPropertyOptional({ type: ImageCropDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => ImageCropDto)
  imageCrop?: ImageCropDto | null;
}

export class UpdateAdminExpertMemberDto {
  @ApiPropertyOptional({ example: 'Анна' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ example: 'Соколова' })
  @IsOptional()
  @IsString()
  lastName?: string;

  @ApiPropertyOptional({ example: 'anna@example.com' })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({ example: '+79991234567' })
  @IsOptional()
  @IsString()
  phoneNumber?: string;

  @ApiPropertyOptional({ example: 5, minimum: 0, maximum: 99 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(99)
  experienceYears?: number;

  @ApiPropertyOptional({ example: ['AmoCRM', 'Bitrix24'], type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  skills?: string[];

  @ApiPropertyOptional({ example: 'Эксперт по CRM интеграциям' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ example: 'https://example.com/expert.jpg' })
  @IsOptional()
  @IsUrl({ require_tld: false, protocols: ['http', 'https'] })
  image?: string | null;

  @ApiPropertyOptional({ type: ImageCropDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => ImageCropDto)
  imageCrop?: ImageCropDto | null;
}
