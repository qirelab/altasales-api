import { ChatbotReferenceAnswer } from '../entities/chatbot-reference-answer.entity';

export const REFERENCE_ANSWER_VECTOR_STORE = Symbol('REFERENCE_ANSWER_VECTOR_STORE');

export type ReferenceAnswerVectorSearchResult = {
  referenceAnswerId: string;
  score: number;
};

export interface ReferenceAnswerVectorStore {
  ensureCollection(): Promise<void>;
  upsertOne(
    referenceAnswer: ChatbotReferenceAnswer,
    embedding: number[],
  ): Promise<void>;
  search(
    queryEmbedding: number[],
    limit: number,
  ): Promise<ReferenceAnswerVectorSearchResult[]>;
  deleteById(referenceAnswerId: string): Promise<void>;
}
