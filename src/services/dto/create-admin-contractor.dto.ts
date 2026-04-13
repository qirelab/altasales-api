import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsInt, IsNumber, IsOptional, IsString, IsUUID, IsUrl, Min } from 'class-validator';

export class CreateAdminContractorDto {
  @ApiPropertyOptional({ example: 'https://example.com/contractor.jpg', description: 'Contractor image URL' })
  @IsOptional()
  @IsUrl()
  image?: string;

  @ApiProperty({ example: 2500, description: 'Contractor hourly rate' })
  @IsNumber()
  @Min(0)
  ratePerHour: number;

  @ApiProperty({ example: 5, description: 'Years of experience' })
  @IsInt()
  @Min(0)
  experienceYears: number;

  @ApiProperty({ example: ['AmoCRM', 'Bitrix24'], description: 'Skills array', type: [String] })
  @IsArray()
  @IsString({ each: true })
  skills: string[];

  @ApiProperty({ example: 'Эксперт по CRM интеграциям', description: 'Contractor description' })
  @IsString()
  description: string;

  @ApiProperty({ description: 'Linked user id' })
  @IsUUID()
  userId: string;
}
