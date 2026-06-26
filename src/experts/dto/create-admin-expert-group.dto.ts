import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsNotEmpty, IsOptional, IsString, IsUrl, MaxLength, ValidateNested } from 'class-validator';
import { ImageCropDto } from '../../common/dto/image-crop.dto';

export class CreateAdminExpertGroupDto {
  @ApiProperty({ example: 'Маркетолог' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  title: string;

  @ApiProperty({ example: 'Стратегия, реклама и аналитика продаж' })
  @IsString()
  @IsNotEmpty()
  description: string;

  @ApiPropertyOptional({ example: 'MRK' })
  @IsOptional()
  @IsString()
  @MaxLength(16)
  iconLabel?: string | null;

  @ApiPropertyOptional({ example: 'https://cdn.example.com/expert-groups/marketing.png' })
  @IsOptional()
  @IsString()
  @IsUrl({ require_protocol: true })
  @MaxLength(1024)
  image?: string | null;

  @ApiPropertyOptional({ type: ImageCropDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => ImageCropDto)
  imageCrop?: ImageCropDto | null;
}

export class UpdateAdminExpertGroupDto extends PartialType(CreateAdminExpertGroupDto) {}
