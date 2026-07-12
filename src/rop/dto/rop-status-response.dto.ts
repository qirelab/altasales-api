import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RopStatusResponseDto {
  @ApiProperty({
    example: true,
    description: 'Whether ROP API credentials are configured on the backend',
  })
  configured: boolean;

  @ApiPropertyOptional({
    example: '42',
    description: 'Current user ROP project ID',
    nullable: true,
  })
  projectId: string | null;
}
