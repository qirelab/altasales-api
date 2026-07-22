import { ApiProperty } from '@nestjs/swagger';

export class RopDocumentListItemResponseDto {
  @ApiProperty({ example: 'Договор оказания услуг v3.pdf' })
  name: string;

  @ApiProperty({ example: '/rop/documents/55/download' })
  downloadUrl: string;
}
