import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { CreateRopDocumentAnalysisLinkDto } from './create-rop-document-analysis-link.dto';

export class CreateRopDashboardAnalysisLinkDto extends CreateRopDocumentAnalysisLinkDto {
  @ApiPropertyOptional({ example: 'page:2' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  partId?: string;
}
