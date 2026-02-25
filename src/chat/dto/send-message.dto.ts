import { ApiProperty } from '@nestjs/swagger';
import { IsUUID, IsString, MinLength, MaxLength } from 'class-validator';

export class SendMessageDto {
  @ApiProperty({
    example: '550e8400-e29b-41d4-a716-446655440000',
    description: 'Recipient user ID',
  })
  @IsUUID()
  recipientId: string;

  @ApiProperty({ example: 'Hello!', description: 'Message text (1-5000 chars)' })
  @IsString()
  @MinLength(1)
  @MaxLength(5000)
  text: string;
}
