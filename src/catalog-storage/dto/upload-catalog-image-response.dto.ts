import { ApiProperty } from '@nestjs/swagger';

export class UploadCatalogImageResponseDto {
  @ApiProperty({
    example: 'https://api.altasales.qirelab.com/uploads/catalog/services/uuid.jpeg',
    description: 'Public URL for catalog image',
  })
  url: string;

  @ApiProperty({ example: 'catalog/services/uuid.jpg', description: 'Object path in Firebase Storage bucket' })
  storagePath: string;
}
