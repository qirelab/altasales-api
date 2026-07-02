import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AgentId } from '../../ai/enums/agent-id.enum';
import { LlmTask } from '../../ai/enums/llm-task.enum';
import { LlmProxyService } from '../../ai/llm-proxy.service';
import { KnowledgeBasePurpose } from '../../knowledge/enums/knowledge-base-purpose.enum';
import {
  KnowledgeSearchResultItem,
  KnowledgeSearchService,
} from '../../knowledge/services/knowledge-search.service';

const DEFAULT_RETRIEVAL_LIMIT = 6;
const DEFAULT_MIN_RELEVANCE_SCORE = 0.35;
const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000;
const DEFAULT_MAX_CONTEXT_CHARS = 12_000;
const REFUSAL_MESSAGE =
  'Я не нашёл информации по этому вопросу. Свяжитесь с менеджером через чат «Помощь» — они смогут помочь.';

const SYSTEM_PROMPT = [
  'Ты — консультант платформы AltaSales.',
  'Отвечай на вопросы клиентов ТОЛЬКО на основе контекста, переданного ниже.',
  '',
  'Строгие правила:',
  '- Никогда не выдумывай факты, цены, имена, даты, сроки, условия.',
  '- Если в контексте нет ответа — честно скажи: «Я не нашёл информации по этому вопросу».',
  '- Не додумывай контекст: если что-то упомянуто вскользь, не расширяй.',
  '- Отвечай на русском языке, кратко и по делу (2–4 предложения).',
  '- Когда даёшь конкретный факт — коротко указывай, из какого документа он взят.',
].join('\n');

export type ChatbotRagInput = {
  question: string;
};

export type ChatbotRagSource = {
  documentId: string;
  documentTitle: string | null;
  chunkIndex: number;
  score: number;
};

export type ChatbotRagRefusalReason =
  | 'empty_question'
  | 'no_results'
  | 'below_threshold'
  | 'empty_llm_response'
  | 'retrieval_failed'
  | 'generation_failed';

export type ChatbotRagResponse = {
  answer: string;
  hasContext: boolean;
  sources: ChatbotRagSource[];
  refusalReason?: ChatbotRagRefusalReason;
};

@Injectable()
export class ChatbotRagService {
  private readonly logger = new Logger(ChatbotRagService.name);
  private readonly retrievalLimit: number;
  private readonly minRelevanceScore: number;
  private readonly cacheTtlMs: number;
  private readonly maxContextChars: number;

  constructor(
    private readonly knowledgeSearch: KnowledgeSearchService,
    private readonly llmProxy: LlmProxyService,
    @Optional()
    private readonly configService?: ConfigService,
  ) {
    this.retrievalLimit = this.readPositiveInt('CHATBOT_RAG_RETRIEVAL_LIMIT', DEFAULT_RETRIEVAL_LIMIT);
    this.minRelevanceScore = this.readPositiveFloat('CHATBOT_RAG_MIN_SCORE', DEFAULT_MIN_RELEVANCE_SCORE);
    this.cacheTtlMs = this.readPositiveInt('CHATBOT_RAG_CACHE_TTL_MS', DEFAULT_CACHE_TTL_MS);
    this.maxContextChars = this.readPositiveInt('CHATBOT_RAG_MAX_CONTEXT_CHARS', DEFAULT_MAX_CONTEXT_CHARS);
  }

  async askQuestion(input: ChatbotRagInput): Promise<ChatbotRagResponse> {
    const startedAt = Date.now();
    const question = input.question.trim();
    if (!question) {
      return this.buildRefusal('empty_question', startedAt, { retrievalMs: 0, totalResults: 0 });
    }

    const retrievalStartedAt = Date.now();
    let results: KnowledgeSearchResultItem[];
    try {
      const searchResponse = await this.knowledgeSearch.search({
        purpose: KnowledgeBasePurpose.QA_CHATBOT,
        query: question,
        limit: this.retrievalLimit,
      });
      results = searchResponse.results;
    } catch (error) {
      this.logger.error(
        `Knowledge search failed: ${(error as Error)?.message ?? String(error)}`,
      );
      return this.buildRefusal('retrieval_failed', startedAt, {
        retrievalMs: Date.now() - retrievalStartedAt,
        totalResults: 0,
      });
    }
    const retrievalMs = Date.now() - retrievalStartedAt;

    const strongResults = results.filter((entry) => entry.score >= this.minRelevanceScore);
    if (strongResults.length === 0) {
      return this.buildRefusal(
        results.length === 0 ? 'no_results' : 'below_threshold',
        startedAt,
        { retrievalMs, totalResults: results.length, topScore: results[0]?.score },
      );
    }

    const contextResults = this.trimToBudget(strongResults, question);
    const userContent = this.buildAugmentedPrompt(question, contextResults);

    const generationStartedAt = Date.now();
    let answer = '';
    try {
      const llmResponse = await this.llmProxy.chat({
        agentId: AgentId.Chatbot,
        task: LlmTask.Reason,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userContent },
        ],
        policy: {
          cacheTtlMs: this.cacheTtlMs,
        },
      });
      answer = llmResponse.content.trim();
    } catch (error) {
      this.logger.error(
        `LLM generation failed: ${(error as Error)?.message ?? String(error)}`,
      );
      return this.buildRefusal('generation_failed', startedAt, {
        retrievalMs,
        totalResults: results.length,
        topScore: results[0]?.score,
        contextChunks: contextResults.length,
        generationMs: Date.now() - generationStartedAt,
      });
    }
    const generationMs = Date.now() - generationStartedAt;

    if (!answer) {
      return this.buildRefusal('empty_llm_response', startedAt, {
        retrievalMs,
        totalResults: results.length,
        contextChunks: contextResults.length,
        generationMs,
      });
    }

    this.logSuccess({
      totalMs: Date.now() - startedAt,
      retrievalMs,
      generationMs,
      totalResults: results.length,
      contextChunks: contextResults.length,
      topScore: contextResults[0]?.score,
    });

    return {
      answer,
      hasContext: true,
      sources: contextResults.map((entry) => ({
        documentId: entry.documentId,
        documentTitle: entry.document.title,
        chunkIndex: entry.chunkIndex,
        score: entry.score,
      })),
    };
  }

  private trimToBudget(
    results: KnowledgeSearchResultItem[],
    question: string,
  ): KnowledgeSearchResultItem[] {
    const baseChars = SYSTEM_PROMPT.length + question.length + 200;
    const budget = Math.max(this.maxContextChars - baseChars, 0);
    if (budget === 0) return results.slice(0, 1);

    const ordered = [...results].sort((a, b) => b.score - a.score);
    const kept: KnowledgeSearchResultItem[] = [];
    let usedChars = 0;
    for (const entry of ordered) {
      const projected = usedChars + entry.text.length + 80;
      if (kept.length > 0 && projected > budget) break;
      kept.push(entry);
      usedChars = projected;
    }
    const keptIds = new Set(kept.map((entry) => entry.chunkId));
    return results.filter((entry) => keptIds.has(entry.chunkId));
  }

  private buildAugmentedPrompt(
    question: string,
    results: KnowledgeSearchResultItem[],
  ): string {
    const contextBlocks = results.map((entry, index) => {
      const label = entry.document.title ?? entry.document.originalFileName;
      return `[Фрагмент ${index + 1}] Источник: ${label}\n${entry.text}`;
    });

    return [
      'Контекст (используй только его для ответа):',
      contextBlocks.join('\n\n---\n\n'),
      '',
      `Вопрос клиента: ${question}`,
    ].join('\n');
  }

  private buildRefusal(
    reason: ChatbotRagRefusalReason,
    startedAt: number,
    metrics: Record<string, number | undefined>,
  ): ChatbotRagResponse {
    this.logger.log(
      `chatbot_rag refusal reason=${reason} totalMs=${Date.now() - startedAt} `
      + Object.entries(metrics)
        .filter(([, value]) => value !== undefined)
        .map(([key, value]) => `${key}=${value}`)
        .join(' '),
    );
    return {
      answer: REFUSAL_MESSAGE,
      hasContext: false,
      sources: [],
      refusalReason: reason,
    };
  }

  private logSuccess(metrics: Record<string, number | undefined>): void {
    this.logger.log(
      'chatbot_rag success '
      + Object.entries(metrics)
        .filter(([, value]) => value !== undefined)
        .map(([key, value]) => `${key}=${value}`)
        .join(' '),
    );
  }

  private readPositiveInt(key: string, fallback: number): number {
    const raw = this.configService?.get<string | number>(key);
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
  }

  private readPositiveFloat(key: string, fallback: number): number {
    const raw = this.configService?.get<string | number>(key);
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  }
}
