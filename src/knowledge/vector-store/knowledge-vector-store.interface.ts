import { KnowledgeBasePurpose } from '../enums/knowledge-base-purpose.enum';
import { KnowledgeChunk } from '../entities/knowledge-chunk.entity';
import { KnowledgeDocument } from '../entities/knowledge-document.entity';

export const KNOWLEDGE_VECTOR_STORE = Symbol('KNOWLEDGE_VECTOR_STORE');

export type KnowledgeVectorSearchFilters = {
  purpose: KnowledgeBasePurpose;
};

export type KnowledgeVectorSearchResult = {
  chunkId: string;
  score: number;
};

export interface KnowledgeVectorStore {
  ensureCollection(): Promise<void>;
  upsertChunks(
    document: KnowledgeDocument,
    chunks: KnowledgeChunk[],
    embeddings: number[][],
  ): Promise<void>;
  search(
    queryEmbedding: number[],
    filters: KnowledgeVectorSearchFilters,
    limit: number,
  ): Promise<KnowledgeVectorSearchResult[]>;
  deleteByDocumentId(documentId: string): Promise<void>;
}
