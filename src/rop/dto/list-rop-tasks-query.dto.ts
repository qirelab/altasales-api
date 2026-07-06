import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class ListRopTasksQueryDto {
  @ApiPropertyOptional({
    example: '2026-04-01',
    description: 'Filter tasks with deadline on or after this date',
  })
  @IsOptional()
  @IsString()
  startDate?: string;

  @ApiPropertyOptional({
    example: '2026-04-30',
    description: 'Filter tasks with deadline on or before this date',
  })
  @IsOptional()
  @IsString()
  endDate?: string;
}
