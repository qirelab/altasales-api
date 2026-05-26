import { Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { EmbeddingProxyService } from '../../ai/embedding-proxy.service';
import { DataClass } from '../../ai/enums/data-class.enum';
import { KnowledgeChunk } from '../entities/knowledge-chunk.entity';
import { KnowledgeBasePurpose } from '../enums/knowledge-base-purpose.enum';
import {
  KNOWLEDGE_VECTOR_STORE,
} from '../vector-store/knowledge-vector-store.interface';
import type { KnowledgeVectorStore } from '../vector-store/knowledge-vector-store.interface';

export type KnowledgeSearchInput = {
  purpose: KnowledgeBasePurpose;
  query: string;
  limit?: number;
};

export type KnowledgeSearchResultItem = {
  chunkId: string;
  documentId: string;
  text: string;
  score: number;
  chunkIndex: number;
  metadata: Record<string, unknown>;
  document: {
    id: string;
    title: string | null;
    purpose: KnowledgeBasePurpose;
    mimeType: string;
    originalFileName: string;
  };
};

@Injectable()
export class KnowledgeSearchService {
  constructor(
    private readonly embeddingProxy: EmbeddingProxyService,
    @Inject(KNOWLEDGE_VECTOR_STORE)
    private readonly vectorStore: KnowledgeVectorStore,
    @InjectRepository(KnowledgeChunk)
    private readonly chunkRepository: Repository<KnowledgeChunk>,
  ) {}

  async search(input: KnowledgeSearchInput): Promise<{
    results: KnowledgeSearchResultItem[];
  }> {
    const limit = Math.min(Math.max(input.limit ?? 10, 1), 50);
    const embedding = await this.embeddingProxy.embed({
      inputs: [input.query],
      declaredDataClass: DataClass.RawPii,
    });
    const vectorResults = await this.vectorStore.search(
      embedding.vectors[0],
      { purpose: input.purpose },
      limit,
    );
    const ids = vectorResults.map((result) => result.chunkId);
    if (!ids.length) {
      return { results: [] };
    }

    const chunks = await this.chunkRepository.find({
      where: { id: In(ids) },
      relations: ['document'],
    });
    const chunksById = new Map(chunks.map((chunk) => [chunk.id, chunk]));
    const results = vectorResults.flatMap((result) => {
      const chunk = chunksById.get(result.chunkId);
      if (!chunk) {
        return [];
      }

      return [{
        chunkId: chunk.id,
        documentId: chunk.documentId,
        text: chunk.text,
        score: result.score,
        chunkIndex: chunk.chunkIndex,
        metadata: chunk.metadata,
        document: {
          id: chunk.document.id,
          title: chunk.document.title,
          purpose: chunk.document.purpose,
          mimeType: chunk.document.mimeType,
          originalFileName: chunk.document.originalFileName,
        },
      }];
    });

    return { results };
  }
}
