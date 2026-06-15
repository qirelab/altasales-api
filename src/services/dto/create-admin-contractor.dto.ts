import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsInt, IsNotEmpty, IsNumber, IsOptional, IsString, IsUUID, IsUrl, Min } from 'class-validator';

export class CreateAdminContractorDto {
  @ApiProperty({ example: 'Иван Иванов — внедрение CRM', description: 'Display name shown in the catalog' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiPropertyOptional({ example: 'https://example.com/contractor.jpg', description: 'Contractor image URL' })
  @IsOptional()
  @IsUrl({ require_tld: false, protocols: ['http', 'https'] })
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

  @ApiProperty({ example: 'CRM-интегратор', description: 'Contractor specialization' })
  @IsString()
  @IsNotEmpty()
  specialization: string;

  @ApiProperty({ description: 'Linked user id' })
  @IsUUID()
  userId: string;
}
