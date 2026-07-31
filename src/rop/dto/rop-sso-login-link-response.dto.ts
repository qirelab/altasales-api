import { ApiProperty } from '@nestjs/swagger';

export class RopSsoLoginLinkResponseDto {
  @ApiProperty({
    example: 'https://ropsharing.dev/sso?code=abc&redirect=%2Fdocuments',
  })
  loginUrl: string;

  @ApiProperty({ example: 120 })
  expiresIn: number;
}
