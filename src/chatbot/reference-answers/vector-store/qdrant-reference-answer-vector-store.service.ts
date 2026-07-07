import { Injectable, Optional, ServiceUnavailableException } from '@nestjs/common';
import { QdrantClient } from '@qdrant/js-client-rest';
import { ChatbotReferenceAnswer } from '../entities/chatbot-reference-answer.entity';
import {
  ReferenceAnswerVectorSearchResult,
  ReferenceAnswerVectorStore,
} from './reference-answer-vector-store.interface';

type QdrantDistance = 'Cosine' | 'Euclid' | 'Dot' | 'Manhattan';

const DEFAULT_QDRANT_URL = 'http://localhost:6333';
const DEFAULT_COLLECTION_NAME = 'altasales_reference_answers';
const DEFAULT_VECTOR_SIZE = 1536;
const DEFAULT_DISTANCE: QdrantDistance = 'Cosine';

@Injectable()
export class QdrantReferenceAnswerVectorStore implements ReferenceAnswerVectorStore {
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
      if (exists.exists) return;

      await this.client.createCollection(this.collectionName, {
        vectors: {
          size: this.vectorSize,
          distance: this.distance,
        },
      });
    } catch (error) {
      if (error instanceof ServiceUnavailableException) throw error;
      throw new ServiceUnavailableException('Reference answer vector store unavailable');
    }
  }

  async upsertOne(
    referenceAnswer: ChatbotReferenceAnswer,
    embedding: number[],
  ): Promise<void> {
    if (embedding.length !== this.vectorSize) {
      throw new ServiceUnavailableException('Reference answer vector size mismatch');
    }
    try {
      await this.client.upsert(this.collectionName, {
        wait: true,
        points: [
          {
            id: referenceAnswer.id,
            vector: embedding,
            payload: {
              referenceAnswerId: referenceAnswer.id,
              topic: referenceAnswer.topic,
            },
          },
        ],
      });
    } catch {
      throw new ServiceUnavailableException('Reference answer vector upsert failed');
    }
  }

  async search(
    queryEmbedding: number[],
    limit: number,
  ): Promise<ReferenceAnswerVectorSearchResult[]> {
    try {
      const results = await this.client.search(this.collectionName, {
        vector: queryEmbedding,
        limit,
        with_payload: true,
      });
      return results.map((result) => ({
        referenceAnswerId: String(result.id),
        score: result.score,
      }));
    } catch {
      throw new ServiceUnavailableException('Reference answer vector search failed');
    }
  }

  async deleteById(referenceAnswerId: string): Promise<void> {
    try {
      await this.client.delete(this.collectionName, {
        wait: true,
        points: [referenceAnswerId],
      });
    } catch {
      throw new ServiceUnavailableException('Reference answer vector delete failed');
    }
  }

  private get collectionName(): string {
    return process.env.QDRANT_REFERENCE_ANSWERS_COLLECTION_NAME || DEFAULT_COLLECTION_NAME;
  }

  private get vectorSize(): number {
    const parsed = Number(process.env.QDRANT_VECTOR_SIZE);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_VECTOR_SIZE;
  }

  private get distance(): QdrantDistance {
    const raw = process.env.QDRANT_DISTANCE;
    if (raw === 'Cosine' || raw === 'Euclid' || raw === 'Dot' || raw === 'Manhattan') {
      return raw;
    }
    return DEFAULT_DISTANCE;
  }
}
