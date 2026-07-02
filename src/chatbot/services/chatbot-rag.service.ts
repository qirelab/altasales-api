import { Injectable, Logger } from '@nestjs/common';
import { AgentId } from '../../ai/enums/agent-id.enum';
import { LlmTask } from '../../ai/enums/llm-task.enum';
import { LlmProxyService } from '../../ai/llm-proxy.service';
import { KnowledgeBasePurpose } from '../../knowledge/enums/knowledge-base-purpose.enum';
import {
  KnowledgeSearchResultItem,
  KnowledgeSearchService,
} from '../../knowledge/services/knowledge-search.service';

const RETRIEVAL_LIMIT = 6;
const MIN_RELEVANCE_SCORE = 0.35;
const CACHE_TTL_MS = 5 * 60 * 1000;
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

export type ChatbotRagResponse = {
  answer: string;
  hasContext: boolean;
  sources: ChatbotRagSource[];
};

@Injectable()
export class ChatbotRagService {
  private readonly logger = new Logger(ChatbotRagService.name);

  constructor(
    private readonly knowledgeSearch: KnowledgeSearchService,
    private readonly llmProxy: LlmProxyService,
  ) {}

  async askQuestion(input: ChatbotRagInput): Promise<ChatbotRagResponse> {
    const question = input.question.trim();
    if (!question) {
      return this.buildRefusal();
    }

    const { results } = await this.knowledgeSearch.search({
      purpose: KnowledgeBasePurpose.QA_CHATBOT,
      query: question,
      limit: RETRIEVAL_LIMIT,
    });

    const strongResults = results.filter((entry) => entry.score >= MIN_RELEVANCE_SCORE);
    if (strongResults.length === 0) {
      this.logger.debug(
        `Refusing empty-context question. total=${results.length}, top=${results[0]?.score ?? 0}`,
      );
      return this.buildRefusal();
    }

    const userContent = this.buildAugmentedPrompt(question, strongResults);
    const llmResponse = await this.llmProxy.chat({
      agentId: AgentId.Chatbot,
      task: LlmTask.Reason,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userContent },
      ],
      policy: {
        cacheTtlMs: CACHE_TTL_MS,
      },
    });

    const answer = llmResponse.content.trim();
    if (!answer) {
      return this.buildRefusal();
    }

    return {
      answer,
      hasContext: true,
      sources: strongResults.map((entry) => ({
        documentId: entry.documentId,
        documentTitle: entry.document.title,
        chunkIndex: entry.chunkIndex,
        score: entry.score,
      })),
    };
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

  private buildRefusal(): ChatbotRagResponse {
    return {
      answer: REFUSAL_MESSAGE,
      hasContext: false,
      sources: [],
    };
  }
}
