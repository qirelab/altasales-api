import { ApiProperty } from '@nestjs/swagger';

export class RopLinkAccessResponseDto {
  @ApiProperty({ example: true })
  accessible: boolean;
}
