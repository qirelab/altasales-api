import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class PublicExpertProfileFieldsDto {
  @ApiProperty({ example: 'Эксперт по CRM интеграциям' })
  description: string;

  @ApiProperty({ example: ['AmoCRM', 'Bitrix24'], type: [String] })
  skills: string[];

  @ApiPropertyOptional({ example: 'https://example.com/expert.jpg' })
  image: string | null;

  @ApiPropertyOptional({ example: 5 })
  experienceYears: number | null;
}

export class PublicExpertGroupServiceDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'Настройка CRM' })
  name: string;

  @ApiPropertyOptional({ example: 'Полная настройка воронки продаж' })
  description: string | null;

  @ApiProperty({ example: 15000 })
  defaultPrice: number;

  @ApiPropertyOptional({ example: 18000 })
  price: number | null;
}

export class PublicExpertGroupDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'CRM-интеграторы' })
  title: string;

  @ApiProperty({ example: 'Эксперты по CRM-системам' })
  description: string;

  @ApiPropertyOptional({ example: 'https://example.com/group.jpg' })
  image: string | null;

  @ApiProperty({ type: [PublicExpertGroupServiceDto] })
  services: PublicExpertGroupServiceDto[];
}

export class PublicExpertStatsDto {
  @ApiProperty({ example: 12 })
  totalProjects: number;

  @ApiProperty({ example: 9 })
  completedProjects: number;
}

export class PublicExpertProfileDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'Анна' })
  name: string;

  @ApiProperty({ example: 'Соколова' })
  lastName: string;

  @ApiProperty({ type: PublicExpertProfileFieldsDto })
  profile: PublicExpertProfileFieldsDto;

  @ApiPropertyOptional({ type: PublicExpertGroupDto })
  group: PublicExpertGroupDto | null;

  @ApiProperty({ type: PublicExpertStatsDto })
  stats: PublicExpertStatsDto;
}
