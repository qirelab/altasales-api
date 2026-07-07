import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatbotReferenceAnswerSearchService } from './chatbot-reference-answer-search.service';

const DEFAULT_ENABLED = true;
const DEFAULT_RETRIEVAL_LIMIT = 3;
const DEFAULT_MIN_SCORE = 0.6;

export type ReferenceInjection = {
  block: string | null;
  usedCount: number;
  topScore?: number;
};

@Injectable()
export class ChatbotReferenceInjectionService {
  private readonly logger = new Logger(ChatbotReferenceInjectionService.name);
  private readonly enabled: boolean;
  private readonly retrievalLimit: number;
  private readonly minScore: number;

  constructor(
    private readonly search: ChatbotReferenceAnswerSearchService,
    @Optional()
    private readonly configService?: ConfigService,
  ) {
    this.enabled = this.readBoolean('CHATBOT_REFERENCE_INJECTION_ENABLED', DEFAULT_ENABLED);
    this.retrievalLimit = this.readPositiveInt(
      'CHATBOT_REFERENCE_RETRIEVAL_LIMIT',
      DEFAULT_RETRIEVAL_LIMIT,
    );
    this.minScore = this.readNonNegativeFloat('CHATBOT_REFERENCE_MIN_SCORE', DEFAULT_MIN_SCORE);
  }

  async getInjection(question: string): Promise<ReferenceInjection> {
    if (!this.enabled) {
      return { block: null, usedCount: 0 };
    }

    let hits;
    try {
      hits = await this.search.searchSimilar({
        question,
        limit: this.retrievalLimit,
        minScore: this.minScore,
      });
    } catch (error) {
      this.logger.warn({
        eventName: 'CHATBOT_REFERENCE_SEARCH_FAILED',
        error: error instanceof Error ? error.message : String(error),
      });
      return { block: null, usedCount: 0 };
    }

    if (hits.length === 0) {
      return { block: null, usedCount: 0 };
    }

    const block = this.buildBlock(hits.map((hit) => hit.referenceAnswer));
    return {
      block,
      usedCount: hits.length,
      topScore: hits[0].score,
    };
  }

  private buildBlock(
    references: { question: string; answer: string }[],
  ): string {
    const items = references.map(
      (ref, index) =>
        `Пример ${index + 1}:\nQ: ${ref.question}\nA: ${ref.answer}`,
    );
    return [
      'Примеры ответов менеджеров на похожие вопросы:',
      ...items,
    ].join('\n\n');
  }

  private readBoolean(key: string, fallback: boolean): boolean {
    const raw = this.configService?.get<string | boolean>(key);
    if (raw === undefined || raw === null || raw === '') return fallback;
    if (typeof raw === 'boolean') return raw;
    return String(raw).toLowerCase() === 'true';
  }

  private readPositiveInt(key: string, fallback: number): number {
    const raw = this.configService?.get<string | number>(key);
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
  }

  private readNonNegativeFloat(key: string, fallback: number): number {
    const raw = this.configService?.get<string | number>(key);
    if (raw === undefined || raw === null || raw === '') return fallback;
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
  }
}
