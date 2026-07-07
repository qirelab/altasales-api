import { Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { EmbeddingProxyService } from '../../../ai/embedding-proxy.service';
import { DataClass } from '../../../ai/enums/data-class.enum';
import { ChatbotReferenceAnswer } from '../entities/chatbot-reference-answer.entity';
import { ReferenceAnswerStatus } from '../enums/reference-answer-status.enum';
import { REFERENCE_ANSWER_VECTOR_STORE } from '../vector-store/reference-answer-vector-store.interface';
import type { ReferenceAnswerVectorStore } from '../vector-store/reference-answer-vector-store.interface';

export type SimilarReferenceAnswer = {
  referenceAnswer: ChatbotReferenceAnswer;
  score: number;
};

export type SearchSimilarInput = {
  question: string;
  limit: number;
  minScore: number;
};

@Injectable()
export class ChatbotReferenceAnswerSearchService {
  constructor(
    private readonly embeddingProxy: EmbeddingProxyService,
    @Inject(REFERENCE_ANSWER_VECTOR_STORE)
    private readonly vectorStore: ReferenceAnswerVectorStore,
    @InjectRepository(ChatbotReferenceAnswer)
    private readonly repository: Repository<ChatbotReferenceAnswer>,
  ) {}

  async searchSimilar(input: SearchSimilarInput): Promise<SimilarReferenceAnswer[]> {
    const question = input.question.trim();
    if (!question || input.limit <= 0) return [];

    const response = await this.embeddingProxy.embed({
      inputs: [question],
      declaredDataClass: DataClass.NoPii,
    });
    const vector = response.vectors[0];
    if (!vector) return [];

    const raw = await this.vectorStore.search(vector, input.limit);
    const filtered = raw.filter((hit) => hit.score >= input.minScore);
    if (filtered.length === 0) return [];

    // Hydrate from DB and drop anything archived / missing since indexing.
    const ids = filtered.map((hit) => hit.referenceAnswerId);
    const rows = await this.repository.find({
      where: { id: In(ids), status: ReferenceAnswerStatus.ACTIVE },
    });
    const byId = new Map(rows.map((row) => [row.id, row]));

    return filtered.flatMap((hit) => {
      const referenceAnswer = byId.get(hit.referenceAnswerId);
      return referenceAnswer
        ? [{ referenceAnswer, score: hit.score }]
        : [];
    });
  }
}
