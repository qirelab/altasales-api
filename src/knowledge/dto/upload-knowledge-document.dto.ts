import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { KnowledgeBasePurpose } from '../enums/knowledge-base-purpose.enum';

export class UploadKnowledgeDocumentDto {
  @ApiProperty({ enum: KnowledgeBasePurpose })
  @IsEnum(KnowledgeBasePurpose)
  purpose: KnowledgeBasePurpose;

  @ApiPropertyOptional({ maxLength: 255 })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  title?: string;

  @ApiPropertyOptional({
    description: 'Optional safe metadata as JSON object string',
  })
  @IsOptional()
  @IsString()
  @MaxLength(10000)
  metadata?: string;

  @ApiPropertyOptional({
    description: 'Optional comma-separated tags',
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  tags?: string;
}
