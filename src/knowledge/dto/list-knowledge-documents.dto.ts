import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { KnowledgeBasePurpose } from '../enums/knowledge-base-purpose.enum';
import { KnowledgeDocumentStatus } from '../enums/knowledge-document-status.enum';

export class ListKnowledgeDocumentsDto {
  @ApiPropertyOptional({ enum: KnowledgeBasePurpose })
  @IsOptional()
  @IsEnum(KnowledgeBasePurpose)
  purpose?: KnowledgeBasePurpose;

  @ApiPropertyOptional({ enum: KnowledgeDocumentStatus })
  @IsOptional()
  @IsEnum(KnowledgeDocumentStatus)
  status?: KnowledgeDocumentStatus;
}
