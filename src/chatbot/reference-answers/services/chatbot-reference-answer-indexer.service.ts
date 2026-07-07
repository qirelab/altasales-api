import { Inject, Injectable, Logger } from '@nestjs/common';
import { EmbeddingProxyService } from '../../../ai/embedding-proxy.service';
import { DataClass } from '../../../ai/enums/data-class.enum';
import { ChatbotReferenceAnswer } from '../entities/chatbot-reference-answer.entity';
import { REFERENCE_ANSWER_VECTOR_STORE } from '../vector-store/reference-answer-vector-store.interface';
import type { ReferenceAnswerVectorStore } from '../vector-store/reference-answer-vector-store.interface';

/**
 * Bridges the CRUD service and the vector store: converts a reference answer's
 * question into an embedding and upserts it into Qdrant. The reference answer
 * itself lives in Postgres — the vector store only stores question embeddings
 * keyed by referenceAnswerId. Question text passed here is already PII-scanned
 * on the CRUD boundary, so declaredDataClass = NoPii.
 */
@Injectable()
export class ChatbotReferenceAnswerIndexerService {
  private readonly logger = new Logger(ChatbotReferenceAnswerIndexerService.name);

  constructor(
    private readonly embeddingProxy: EmbeddingProxyService,
    @Inject(REFERENCE_ANSWER_VECTOR_STORE)
    private readonly vectorStore: ReferenceAnswerVectorStore,
  ) {}

  async index(referenceAnswer: ChatbotReferenceAnswer): Promise<void> {
    await this.vectorStore.ensureCollection();
    const response = await this.embeddingProxy.embed({
      inputs: [referenceAnswer.question],
      declaredDataClass: DataClass.NoPii,
    });
    const vector = response.vectors[0];
    if (!vector) {
      throw new Error('Reference answer embedding is empty');
    }
    await this.vectorStore.upsertOne(referenceAnswer, vector);
  }

  async remove(referenceAnswerId: string): Promise<void> {
    await this.vectorStore.deleteById(referenceAnswerId);
  }

  /**
   * Fire-and-forget index/remove that logs failure but never throws to the
   * caller. Used from the CRUD hooks so DB persistence is not rolled back if
   * Qdrant is momentarily unavailable — the record stays in the DB and can
   * be re-indexed on the next update.
   */
  safeIndex(referenceAnswer: ChatbotReferenceAnswer): Promise<void> {
    return this.index(referenceAnswer).catch((error) => {
      this.logger.warn({
        eventName: 'CHATBOT_REFERENCE_INDEX_FAILED',
        referenceAnswerId: referenceAnswer.id,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }

  safeRemove(referenceAnswerId: string): Promise<void> {
    return this.remove(referenceAnswerId).catch((error) => {
      this.logger.warn({
        eventName: 'CHATBOT_REFERENCE_INDEX_DELETE_FAILED',
        referenceAnswerId,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }
}
