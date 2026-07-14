import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AgentId } from '../../ai/enums/agent-id.enum';
import { DataClass } from '../../ai/enums/data-class.enum';
import { LlmTask } from '../../ai/enums/llm-task.enum';
import type { LlmMessage } from '../../ai/interfaces/llm-message.interface';
import { LlmProxyService } from '../../ai/llm-proxy.service';

const DEFAULT_ENABLED = true;
const DEFAULT_MAX_HISTORY_MESSAGES = 6;
const MAX_REWRITE_CHARS = 300;

const REWRITE_SYSTEM_PROMPT = [
  'Ты помощник по переформулировке вопросов в чате.',
  'Тебе дают: (1) предыдущую переписку клиента с ботом; (2) последний вопрос клиента.',
  'Твоя задача — переписать последний вопрос как самостоятельный поисковый запрос,',
  'подставив недостающий контекст из истории (названия продуктов, услуг, объекты).',
  '',
  'Строгие правила:',
  '- Верни ТОЛЬКО одну переформулированную фразу, без пояснений, кавычек, префиксов.',
  '- Не отвечай на вопрос, только переформулируй.',
  '- Если вопрос и так самостоятельный, верни его как есть.',
  '- Не добавляй новые факты, только подтягивай контекст из истории.',
  '- Пиши на том же языке, что и вопрос клиента.',
  '- Максимум 300 символов.',
].join('\n');

@Injectable()
export class ChatbotQueryRewriterService {
  private readonly logger = new Logger(ChatbotQueryRewriterService.name);
  private readonly enabled: boolean;
  private readonly maxHistoryMessages: number;

  constructor(
    private readonly llmProxy: LlmProxyService,
    @Optional() private readonly configService?: ConfigService,
  ) {
    this.enabled = this.readBoolean('CHATBOT_QUERY_REWRITE_ENABLED', DEFAULT_ENABLED);
    this.maxHistoryMessages = this.readPositiveInt(
      'CHATBOT_QUERY_REWRITE_MAX_HISTORY_MESSAGES',
      DEFAULT_MAX_HISTORY_MESSAGES,
    );
  }

  async rewrite(question: string, historyMessages: LlmMessage[]): Promise<string> {
    if (!this.enabled || historyMessages.length === 0) return question;

    const recent = historyMessages.slice(-this.maxHistoryMessages);
    const historyText = recent
      .map((message) => `${message.role === 'user' ? 'Клиент' : 'Бот'}: ${message.content}`)
      .join('\n');

    try {
      const response = await this.llmProxy.chat({
        agentId: AgentId.Chatbot,
        task: LlmTask.Reason,
        declaredDataClass: DataClass.NoPii,
        messages: [
          { role: 'system', content: REWRITE_SYSTEM_PROMPT },
          {
            role: 'user',
            content: `История:\n${historyText}\n\nПоследний вопрос: ${question}`,
          },
        ],
      });
      const rewritten = response.content.trim().slice(0, MAX_REWRITE_CHARS);
      return rewritten || question;
    } catch (error) {
      // Fail-open: retrieval keeps using the original query on rewrite failure.
      this.logger.warn({
        eventName: 'CHATBOT_QUERY_REWRITE_FAILED',
        error: error instanceof Error ? error.message : String(error),
      });
      return question;
    }
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
}
