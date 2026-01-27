import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class VerifyTokenDto {
  @ApiProperty({ example: 'eyJhbGciOiJSUzI1NiIs...', description: 'Firebase ID token' })
  @IsString()
  idToken: string;
}


