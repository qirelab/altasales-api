import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AgentId } from '../../ai/enums/agent-id.enum';
import { DataClass } from '../../ai/enums/data-class.enum';
import { LlmTask } from '../../ai/enums/llm-task.enum';
import { LlmProxyService } from '../../ai/llm-proxy.service';
import { KnowledgeBasePurpose } from '../../knowledge/enums/knowledge-base-purpose.enum';
import {
  KnowledgeSearchResultItem,
  KnowledgeSearchService,
} from '../../knowledge/services/knowledge-search.service';
import { ChatbotReferenceInjectionService } from '../reference-answers/services/chatbot-reference-injection.service';
import {
  DEFAULT_CACHE_TTL_MS,
  DEFAULT_MAX_CONTEXT_CHARS,
  DEFAULT_MIN_RELEVANCE_SCORE,
  DEFAULT_RETRIEVAL_LIMIT,
  EVENT_REFUSED,
  EVENT_SUCCEEDED,
  INFRA_ERROR_MESSAGE,
  INFRA_REFUSAL_REASONS,
  MAX_QUESTION_CHARS,
  NO_INFO_MESSAGE,
  SYSTEM_PROMPT,
} from './chatbot-rag.constants';
import type {
  ChatbotRagInput,
  ChatbotRagRefusalReason,
  ChatbotRagResponse,
} from './chatbot-rag.types';

export type { ChatbotRagInput, ChatbotRagResponse, ChatbotRagRefusalReason } from './chatbot-rag.types';

type RefusalMetrics = Record<string, number | undefined>;

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
    private readonly referenceInjection: ChatbotReferenceInjectionService,
    @Optional()
    private readonly configService?: ConfigService,
  ) {
    this.retrievalLimit = this.readPositiveInt('CHATBOT_RAG_RETRIEVAL_LIMIT', DEFAULT_RETRIEVAL_LIMIT);
    // MIN_SCORE=0 explicitly disables the threshold; any negative value falls back to the default.
    this.minRelevanceScore = this.readNonNegativeFloat('CHATBOT_RAG_MIN_SCORE', DEFAULT_MIN_RELEVANCE_SCORE);
    this.cacheTtlMs = this.readPositiveInt('CHATBOT_RAG_CACHE_TTL_MS', DEFAULT_CACHE_TTL_MS);
    this.maxContextChars = this.readPositiveInt('CHATBOT_RAG_MAX_CONTEXT_CHARS', DEFAULT_MAX_CONTEXT_CHARS);
  }

  async askQuestion(input: ChatbotRagInput): Promise<ChatbotRagResponse> {
    const startedAt = Date.now();
    const question = input.question.trim().slice(0, MAX_QUESTION_CHARS);
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
    if (contextResults.length === 0) {
      return this.buildRefusal('context_too_large', startedAt, {
        retrievalMs,
        totalResults: results.length,
        topScore: strongResults[0]?.score,
      });
    }
    const userContent = this.buildAugmentedPrompt(question, contextResults);
    const injection = await this.referenceInjection.getInjection(question);
    const systemContent = injection.block
      ? `${SYSTEM_PROMPT}\n\n${injection.block}`
      : SYSTEM_PROMPT;

    const generationStartedAt = Date.now();
    let answer = '';
    try {
      const llmResponse = await this.llmProxy.chat({
        agentId: AgentId.Chatbot,
        task: LlmTask.Reason,
        declaredDataClass: DataClass.NoPii,
        messages: [
          { role: 'system', content: systemContent },
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
      referenceCount: injection.usedCount,
      referenceTopScore: injection.topScore,
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
    const budget = this.maxContextChars - baseChars;
    if (budget <= 0) return [];

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
    metrics: RefusalMetrics,
  ): ChatbotRagResponse {
    const isInfra = INFRA_REFUSAL_REASONS.has(reason);
    this.logger.log({
      eventName: EVENT_REFUSED,
      reason,
      totalMs: Date.now() - startedAt,
      ...this.pickDefined(metrics),
    });
    return {
      answer: isInfra ? INFRA_ERROR_MESSAGE : NO_INFO_MESSAGE,
      hasContext: false,
      sources: [],
      refusalReason: reason,
    };
  }

  private logSuccess(metrics: RefusalMetrics): void {
    this.logger.log({
      eventName: EVENT_SUCCEEDED,
      ...this.pickDefined(metrics),
    });
  }

  private pickDefined(metrics: RefusalMetrics): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [key, value] of Object.entries(metrics)) {
      if (value !== undefined) out[key] = value;
    }
    return out;
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
