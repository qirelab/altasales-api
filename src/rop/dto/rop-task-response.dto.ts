import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RopTaskResponseDto {
  @ApiProperty({ example: '310' })
  id: string;

  @ApiProperty({ example: '42' })
  projectId: string;

  @ApiProperty({ example: 'Согласовать договор с партнёром X' })
  title: string;

  @ApiPropertyOptional({ example: 'Дедлайн жёсткий — нужно до конца недели', nullable: true })
  comment?: string | null;

  @ApiPropertyOptional({ example: 'https://docs.example.com/agreement-v3.pdf', nullable: true })
  documentLink?: string | null;

  @ApiPropertyOptional({ example: '2026-04-20T18:00:00Z', nullable: true })
  endDate?: string | null;

  @ApiPropertyOptional({ example: 4.5, nullable: true })
  hoursSpent?: number | null;

  @ApiPropertyOptional({ example: 2, nullable: true })
  priorityId?: number | null;

  @ApiPropertyOptional({ example: '2026-04-12', nullable: true })
  startDate?: string | null;

  @ApiPropertyOptional({ example: 3, nullable: true })
  stateId?: number | null;

  @ApiPropertyOptional({ example: '2026-04-18T14:20:00Z', nullable: true })
  stateUpdatedAt?: string | null;

  @ApiPropertyOptional({ example: 'Договор подписан, отправлен в архив', nullable: true })
  taskResult?: string | null;

  @ApiPropertyOptional({ example: '2026-04-12T10:30:00Z' })
  createdAt?: string;

  @ApiPropertyOptional({ example: '2026-04-18T14:20:00Z' })
  updatedAt?: string;
}
