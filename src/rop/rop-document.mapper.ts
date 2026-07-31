import { RopDocumentResponseDto } from './dto/rop-document-response.dto';
import { repairUtf8Mojibake } from './rop-filename.util';
import { RopDocumentRecord } from './rop.types';

export function mapRopDocument(
  document: RopDocumentRecord,
): RopDocumentResponseDto {
  return {
    id: String(document.id),
    projectId: String(document.project_id),
    name: repairUtf8Mojibake(document.name),
    downloadUrl: `/rop/documents/${encodeURIComponent(String(document.id))}/download`,
    description: document.description ?? null,
    comment: document.comment ?? null,
    link: document.link ?? null,
    categoryId: document.category_id ?? null,
    statusId: document.status_id ?? null,
    fileId: document.file_id ?? null,
    createdAt: document.created_at,
    updatedAt: document.updated_at,
  };
}
