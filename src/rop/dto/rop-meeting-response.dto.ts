import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RopMeetingResponseDto {
  @ApiProperty({ example: '510' })
  id: string;

  @ApiProperty({ example: '42' })
  projectId: string;

  @ApiPropertyOptional({ example: 'Созвон по статусу внедрения', nullable: true })
  title?: string | null;

  @ApiPropertyOptional({ example: 'Обсуждение текущего этапа', nullable: true })
  description?: string | null;

  @ApiPropertyOptional({ example: 'Подготовить финальный отчет', nullable: true })
  comment?: string | null;

  @ApiPropertyOptional({ example: '2026-04-20', nullable: true })
  meetingDate?: string | null;

  @ApiPropertyOptional({ example: '2026-04-20T12:00:00Z', nullable: true })
  startsAt?: string | null;

  @ApiPropertyOptional({ example: '2026-04-20T13:00:00Z', nullable: true })
  endsAt?: string | null;

  @ApiPropertyOptional({ example: 'https://meet.example.com/room/123', nullable: true })
  link?: string | null;

  @ApiPropertyOptional({ example: 2, nullable: true })
  statusId?: number | null;

  @ApiPropertyOptional({ example: '2026-04-18T10:30:00Z' })
  createdAt?: string;

  @ApiPropertyOptional({ example: '2026-04-18T14:20:00Z' })
  updatedAt?: string;
}
