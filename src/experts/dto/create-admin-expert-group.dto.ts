import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

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
  @MaxLength(1024)
  image?: string | null;
}

export class UpdateAdminExpertGroupDto extends PartialType(CreateAdminExpertGroupDto) {}
