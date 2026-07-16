import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class RopMonthDashboardQueryDto {
  @ApiProperty({ example: '7', description: 'ROP department ID' })
  @IsString()
  departmentId: string;

  @ApiPropertyOptional({ example: '2026-04-01' })
  @IsOptional()
  @IsString()
  startDate?: string;

  @ApiPropertyOptional({ example: '2026-04-30' })
  @IsOptional()
  @IsString()
  endDate?: string;
}

export class RopIntervalDashboardQueryDto {
  @ApiProperty({ example: '7', description: 'ROP department ID' })
  @IsString()
  departmentId: string;

  @ApiProperty({ example: '2026-04-01' })
  @IsString()
  startDate: string;

  @ApiProperty({ example: '2026-04-15' })
  @IsString()
  endDate: string;
}

export class RopBenchmarkDecompositionQueryDto {
  @ApiProperty({ example: '7', description: 'ROP department ID' })
  @IsString()
  departmentId: string;

  @ApiProperty({ example: '2026-04-01', description: 'Month date (first day recommended)' })
  @IsString()
  analyzeDate: string;
}
