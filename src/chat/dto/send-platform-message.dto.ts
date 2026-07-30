import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

export class SendPlatformMessageDto {
  @ApiProperty({
    example: 'Расскажи про пакет CRM Silver.',
    description: 'Message text sent by the client / expert / operator.',
    maxLength: 4000,
  })
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  text: string;

  @ApiPropertyOptional({
    type: [String],
    description: 'Attached file IDs.',
  })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  fileIds?: string[];
}
