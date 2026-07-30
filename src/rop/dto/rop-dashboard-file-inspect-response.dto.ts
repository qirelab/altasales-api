import { ApiProperty } from '@nestjs/swagger';

export class RopDashboardFilePartDto {
  @ApiProperty({ example: 'page:2' })
  id: string;

  @ApiProperty({ example: 'Страница 2' })
  label: string;
}

export class RopDashboardFileInspectResponseDto {
  @ApiProperty({ type: RopDashboardFilePartDto, isArray: true })
  parts: RopDashboardFilePartDto[];

  @ApiProperty({ enum: ['page', 'sheet', 'file'], example: 'page' })
  partType: 'page' | 'sheet' | 'file';
}
