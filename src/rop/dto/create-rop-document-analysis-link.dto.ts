import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
} from 'class-validator';

export class CreateRopDocumentAnalysisLinkDto {
  @ApiProperty({ example: 'https://example.com/files/sales-regulation.pdf' })
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  @MaxLength(2048)
  link: string;

  @ApiPropertyOptional({ example: 'Регламент работы отдела продаж' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name?: string;
}
