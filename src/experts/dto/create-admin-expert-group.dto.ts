import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, IsUrl, MaxLength } from 'class-validator';

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

  @ApiPropertyOptional({
    example: 'https://cdn.example.com/expert-groups/marketing-original.png',
    description: 'Original (uncropped) image URL for non-destructive re-crop',
  })
  @IsOptional()
  @IsString()
  @IsUrl({ require_protocol: true })
  @MaxLength(1024)
  imageOriginal?: string | null;
}

export class UpdateAdminExpertGroupDto extends PartialType(CreateAdminExpertGroupDto) {}
