import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RopDocumentResponseDto {
  @ApiProperty({ example: '55' })
  id: string;

  @ApiProperty({ example: '42' })
  projectId: string;

  @ApiProperty({ example: 'Договор оказания услуг v3.pdf' })
  name: string;

  @ApiProperty({ example: '/rop/documents/55/download' })
  downloadUrl: string;

  @ApiPropertyOptional({ example: 'Актуальная версия договора', nullable: true })
  description?: string | null;

  @ApiPropertyOptional({ example: 'Подписан обеими сторонами', nullable: true })
  comment?: string | null;

  @ApiPropertyOptional({ nullable: true })
  link?: string | null;

  @ApiPropertyOptional({ example: 2, nullable: true })
  categoryId?: number | null;

  @ApiPropertyOptional({ example: 3, nullable: true })
  statusId?: number | null;

  @ApiPropertyOptional({ example: 912, nullable: true })
  fileId?: number | null;

  @ApiPropertyOptional({ example: '2026-04-12T10:30:00Z' })
  createdAt?: string;

  @ApiPropertyOptional({ example: '2026-04-12T14:20:00Z' })
  updatedAt?: string;
}
