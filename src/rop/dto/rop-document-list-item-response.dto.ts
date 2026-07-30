import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RopDocumentListItemResponseDto {
  @ApiProperty({ example: '55' })
  id: string;

  @ApiProperty({ example: 'Договор оказания услуг v3.pdf' })
  name: string;

  @ApiProperty({ example: '/rop/documents/55/download' })
  downloadUrl: string;

  @ApiPropertyOptional({ example: 1, nullable: true })
  categoryId?: number | null;

  @ApiPropertyOptional({ example: '2026-04-12T10:30:00Z' })
  createdAt?: string;
}
