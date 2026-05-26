import {
  Injectable,
  Logger,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { QdrantClient } from '@qdrant/js-client-rest';
import { KnowledgeChunk } from '../entities/knowledge-chunk.entity';
import { KnowledgeDocument } from '../entities/knowledge-document.entity';
import {
  KnowledgeVectorSearchFilters,
  KnowledgeVectorSearchResult,
  KnowledgeVectorStore,
} from './knowledge-vector-store.interface';

type QdrantPayload = Record<string, unknown>;
type QdrantDistance = 'Cosine' | 'Euclid' | 'Dot' | 'Manhattan';
type QdrantVectorParams = {
  size: number;
  distance: QdrantDistance;
};

const DEFAULT_QDRANT_URL = 'http://localhost:6333';
const DEFAULT_COLLECTION_NAME = 'altasales_knowledge_chunks';
const DEFAULT_VECTOR_SIZE = 1536;
const DEFAULT_DISTANCE = 'Cosine';

@Injectable()
export class QdrantKnowledgeVectorStore implements KnowledgeVectorStore {
  private readonly logger = new Logger(QdrantKnowledgeVectorStore.name);
  private readonly client: QdrantClient;

  constructor(@Optional() client?: QdrantClient) {
    this.client = client
      ?? new QdrantClient({
        url: process.env.QDRANT_URL || DEFAULT_QDRANT_URL,
        apiKey: process.env.QDRANT_API_KEY || undefined,
      });
  }

  async ensureCollection(): Promise<void> {
    try {
      const exists = await this.client.collectionExists(this.collectionName);
      if (exists.exists) {
        const collection = await this.client.getCollection(this.collectionName);
        this.assertCollectionConfig(collection);
        return;
      }

      await this.client.createCollection(this.collectionName, {
        vectors: {
          size: this.vectorSize,
          distance: this.distance,
        },
      });
    } catch (error) {
      if (error instanceof ServiceUnavailableException) {
        throw error;
      }
      throw new ServiceUnavailableException('Knowledge vector store unavailable');
    }
  }

  async upsertChunks(
    document: KnowledgeDocument,
    chunks: KnowledgeChunk[],
    embeddings: number[][],
  ): Promise<void> {
    if (chunks.length !== embeddings.length) {
      throw new ServiceUnavailableException('Knowledge vector count mismatch');
    }

    try {
      await this.client.upsert(this.collectionName, {
        wait: true,
        points: chunks.map((chunk, index) => ({
          id: chunk.id,
          vector: embeddings[index],
          payload: this.buildPayload(document, chunk),
        })),
      });
    } catch {
      throw new ServiceUnavailableException('Knowledge vector upsert failed');
    }
  }

  async search(
    queryEmbedding: number[],
    filters: KnowledgeVectorSearchFilters,
    limit: number,
  ): Promise<KnowledgeVectorSearchResult[]> {
    try {
      const results = await this.client.search(this.collectionName, {
        vector: queryEmbedding,
        limit,
        with_payload: true,
        with_vector: false,
        filter: {
          must: [
            {
              key: 'purpose',
              match: { value: filters.purpose },
            },
          ],
        },
      });

      return results.flatMap((result) => {
        const chunkId = this.readPayloadString(result.payload, 'chunkId');
        if (!chunkId) {
          return [];
        }

        return [{ chunkId, score: result.score }];
      });
    } catch {
      throw new ServiceUnavailableException('Knowledge vector search failed');
    }
  }

  async deleteByDocumentId(documentId: string): Promise<void> {
    try {
      await this.client.delete(this.collectionName, {
        wait: true,
        filter: {
          must: [
            {
              key: 'documentId',
              match: { value: documentId },
            },
          ],
        },
      });
    } catch {
      throw new ServiceUnavailableException('Knowledge vector delete failed');
    }
  }

  private buildPayload(
    document: KnowledgeDocument,
    chunk: KnowledgeChunk,
  ): QdrantPayload {
    return {
      purpose: document.purpose,
      documentId: document.id,
      chunkId: chunk.id,
      chunkIndex: chunk.chunkIndex,
      mimeType: document.mimeType,
      originalFileName: document.originalFileName,
      metadata: this.compactMetadata(chunk.metadata),
    };
  }

  private compactMetadata(
    metadata: Record<string, unknown> | undefined,
  ): Record<string, unknown> {
    if (!metadata) {
      return {};
    }

    return Object.fromEntries(
      Object.entries(metadata).filter(([, value]) =>
        ['string', 'number', 'boolean'].includes(typeof value),
      ),
    );
  }

  private readPayloadString(
    payload: unknown,
    key: string,
  ): string | undefined {
    if (!payload || typeof payload !== 'object') {
      return undefined;
    }

    const value = (payload as Record<string, unknown>)[key];
    return typeof value === 'string' ? value : undefined;
  }

  private assertCollectionConfig(collection: unknown): void {
    const actual = this.readSingleVectorConfig(collection);
    const expected: QdrantVectorParams = {
      size: this.vectorSize,
      distance: this.distance,
    };

    if (
      !actual ||
      actual.size !== expected.size ||
      actual.distance !== expected.distance
    ) {
      this.logger.error({
        eventName: 'KNOWLEDGE_VECTOR_COLLECTION_CONFIG_MISMATCH',
        collectionName: this.collectionName,
        expectedVectorSize: expected.size,
        actualVectorSize: actual?.size ?? null,
        expectedDistance: expected.distance,
        actualDistance: actual?.distance ?? null,
      });
      throw new ServiceUnavailableException(
        'Knowledge vector store configuration mismatch',
      );
    }
  }

  private readSingleVectorConfig(
    collection: unknown,
  ): QdrantVectorParams | undefined {
    const vectors = this.readNestedRecord(
      collection,
      ['config', 'params', 'vectors'],
    );
    const size = vectors?.size;
    const distance = vectors?.distance;

    if (
      typeof size === 'number' &&
      this.isDistance(distance)
    ) {
      return { size, distance };
    }

    return undefined;
  }

  private readNestedRecord(
    value: unknown,
    path: string[],
  ): Record<string, unknown> | undefined {
    let current = value;
    for (const key of path) {
      if (!current || typeof current !== 'object' || Array.isArray(current)) {
        return undefined;
      }
      current = (current as Record<string, unknown>)[key];
    }

    return current && typeof current === 'object' && !Array.isArray(current)
      ? current as Record<string, unknown>
      : undefined;
  }

  private isDistance(value: unknown): value is QdrantDistance {
    return value === 'Cosine' ||
      value === 'Euclid' ||
      value === 'Dot' ||
      value === 'Manhattan';
  }

  private get collectionName(): string {
    return process.env.QDRANT_COLLECTION_NAME || DEFAULT_COLLECTION_NAME;
  }

  private get vectorSize(): number {
    const parsed = Number(process.env.QDRANT_VECTOR_SIZE);
    return Number.isFinite(parsed) && parsed > 0
      ? parsed
      : DEFAULT_VECTOR_SIZE;
  }

  private get distance(): QdrantDistance {
    const value = process.env.QDRANT_DISTANCE;
    if (
      value === 'Cosine' ||
      value === 'Euclid' ||
      value === 'Dot' ||
      value === 'Manhattan'
    ) {
      return value;
    }

    return DEFAULT_DISTANCE;
  }
}
