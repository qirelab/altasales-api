import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AgentId } from '../../ai/enums/agent-id.enum';
import { DataClass } from '../../ai/enums/data-class.enum';
import { LlmTask } from '../../ai/enums/llm-task.enum';
import { LlmProxyService } from '../../ai/llm-proxy.service';
import type { LlmMessage } from '../../ai/interfaces/llm-message.interface';
import { CHAT_INTENT_VALUES, ChatIntent, parseChatIntent } from '../enums/chat-intent.enum';

const DEFAULT_ENABLED = true;
const MAX_QUESTION_CHARS = 800;
const MAX_HISTORY_TURNS = 4;
const MAX_HISTORY_CHARS_PER_TURN = 400;
const EVENT_CLASSIFIED = 'CHATBOT_INTENT_CLASSIFIED';
const EVENT_FAILED = 'CHATBOT_INTENT_CLASSIFIER_FAILED';

export type ClassifiedIntent = {
  intent: ChatIntent;
  // Whether the current turn is a standalone FAQ-style question worth serving
  // from the curated reference bank verbatim. Follow-ups, confirmations,
  // clarifications, and reactions to prior assistant turns should be `false`
  // so the pipeline stays with the LLM + history and does not paste a
  // pre-baked answer that ignores the running context.
  useReferenceBank: boolean;
};

export type ClassifierHistoryEntry = {
  role: 'user' | 'assistant';
  content: string;
};

const CLASSIFIER_SYSTEM_PROMPT = [
  'Ты классификатор сообщений клиента в чате AltaSales.',
  'AltaSales — платформа рекомендаций и услуг для отделов продаж',
  '(построение отделов, обучение, экспертное сопровождение, найм).',
  '',
  'Верни РОВНО одну строку JSON без пояснений и без ```-обёрток:',
  '{"intent":"<ярлык>","useReferenceBank":<true|false>}',
  '',
  '## Поле intent',
  '',
  `- ${ChatIntent.Greeting} — приветствие, благодарность, прощание,`,
  '  короткая реплика без вопроса.',
  `- ${ChatIntent.Meta} — вопрос про сам диалог: «что мы обсуждали»,`,
  '  «повтори», «о чём мы говорили».',
  `- ${ChatIntent.ExplicitHandoff} — прямая просьба соединить с человеком:`,
  '  «позовите менеджера», «хочу оператора», «свяжите со специалистом»,',
  '  «нужен живой человек».',
  `- ${ChatIntent.OffTopic} — тема вне AltaSales и вне продаж: политика,`,
  '  погода, спорт, анекдоты, философия, программирование, общие вопросы.',
  `- ${ChatIntent.PlatformQuestion} — вопрос про платформу, её услуги,`,
  '  пакеты, экспертов, оплату, аккаунт, рекомендации, статус заказов.',
  `- ${ChatIntent.SalesQuestion} — общий вопрос про построение или работу`,
  '  отдела продаж, не про конкретную услугу AltaSales: воронки, KPI,',
  '  найм, скрипты, работа с возражениями.',
  '',
  'Правила по intent:',
  '- Сомневаешься между platform_question и sales_question -',
  '  выбирай platform_question.',
  '- Сомневаешься между off_topic и sales_question - выбирай sales_question.',
  '- Сомневаешься между off_topic и platform_question - выбирай off_topic.',
  '  False-positive platform → пустой RAG → напрасная эскалация команде.',
  '- Политики, условия, гарантии, возврат денег, скидки, партнёрские',
  '  программы, лицензии, договоры AltaSales - всегда platform_question.',
  '- Никогда не выбирай explicit_handoff если клиент просто задаёт вопрос',
  '  без просьбы соединить с человеком.',
  '',
  '## Поле useReferenceBank',
  '',
  'Банк эталонных ответов - FAQ с готовыми дословными ответами на прямые',
  'вопросы про AltaSales.',
  'Ставь true ТОЛЬКО когда всё выполнено одновременно:',
  '1. intent = platform_question ИЛИ (intent = greeting и клиент прямо',
  '   спрашивает «кто вы?», «что вы делаете?»).',
  '2. Клиент задаёт САМОСТОЯТЕЛЬНЫЙ вопрос по существу, а не реагирует',
  '   на предыдущую реплику ассистента.',
  '3. Вопрос можно ответить сам по себе, без опоры на историю разговора.',
  '',
  'Ставь false когда:',
  '- Это переспрос или подтверждение к предыдущему ответу («то есть X?»,',
  '  «правильно понимаю?», «так значит…», «ага, а что если…»).',
  '- Это уточнение к тому, что ассистент только что сказал («а подробнее?»,',
  '  «а как именно?», «а что именно вы имеете в виду?»).',
  '- Это короткая реакция без нового вопроса («ок», «понятно», «спасибо»).',
  '- intent = off_topic, meta, explicit_handoff, sales_question.',
  '- Сомневаешься. Дефолт false: LLM с историей всегда ответит осмысленно,',
  '  а банк без контекста может выдать не в тему.',
  '',
  '## Примеры',
  '',
  `«Здравствуйте» → {"intent":"${ChatIntent.Greeting}","useReferenceBank":false}`,
  `«Кто вы такие?» → {"intent":"${ChatIntent.Greeting}","useReferenceBank":true}`,
  `«О чём мы говорили выше» → {"intent":"${ChatIntent.Meta}","useReferenceBank":false}`,
  `«Позовите менеджера» → {"intent":"${ChatIntent.ExplicitHandoff}","useReferenceBank":false}`,
  `«Что о погоде?» → {"intent":"${ChatIntent.OffTopic}","useReferenceBank":false}`,
  `«Что входит в пакет РОП?» → {"intent":"${ChatIntent.PlatformQuestion}","useReferenceBank":true}`,
  `«Как оплатить с баланса?» → {"intent":"${ChatIntent.PlatformQuestion}","useReferenceBank":true}`,
  `«А подробнее можно?» (после ответа ассистента) → {"intent":"${ChatIntent.PlatformQuestion}","useReferenceBank":false}`,
  `«То есть ты профессионал на платформе, да?» → {"intent":"${ChatIntent.PlatformQuestion}","useReferenceBank":false}`,
  `«Правильно понимаю, что услуга платная?» → {"intent":"${ChatIntent.PlatformQuestion}","useReferenceBank":false}`,
  `«Как правильно строить воронку B2B» → {"intent":"${ChatIntent.SalesQuestion}","useReferenceBank":false}`,
].join('\n');

@Injectable()
export class ChatbotIntentClassifierService {
  private readonly logger = new Logger(ChatbotIntentClassifierService.name);
  private readonly enabled: boolean;

  constructor(
    private readonly llmProxy: LlmProxyService,
    @Optional() private readonly configService?: ConfigService,
  ) {
    this.enabled = this.readBoolean('CHATBOT_INTENT_CLASSIFIER_ENABLED', DEFAULT_ENABLED);
  }

  async classify(
    question: string,
    history: ClassifierHistoryEntry[] = [],
  ): Promise<ClassifiedIntent> {
    if (!this.enabled) return { intent: ChatIntent.PlatformQuestion, useReferenceBank: false };
    const cleaned = question.trim().slice(0, MAX_QUESTION_CHARS);
    if (!cleaned) return { intent: ChatIntent.Greeting, useReferenceBank: false };

    const startedAt = Date.now();
    const messages = this.buildMessages(cleaned, history);
    try {
      const response = await this.llmProxy.chat({
        agentId: AgentId.Chatbot,
        task: LlmTask.Classify,
        declaredDataClass: DataClass.NoPii,
        messages,
      });
      const raw = response.content ?? '';
      const parsed = this.parseResponse(raw);
      const result: ClassifiedIntent = parsed ?? {
        // Fallback when the LLM answer can't be parsed: SalesQuestion + no
        // reference bank. PlatformQuestion + empty RAG triggers a handoff,
        // so an unparseable classifier response would systematically page
        // the AltaSales team for every off-topic user message during an
        // outage. SalesQuestion + false bank lets the LLM answer from general
        // knowledge without escalation and without a stale FAQ paste.
        intent: ChatIntent.SalesQuestion,
        useReferenceBank: false,
      };
      this.logger.log({
        eventName: EVENT_CLASSIFIED,
        intent: result.intent,
        useReferenceBank: result.useReferenceBank,
        rawMatched: parsed !== null,
        historyTurns: Math.min(history.length, MAX_HISTORY_TURNS),
        latencyMs: Date.now() - startedAt,
      });
      return result;
    } catch (error) {
      this.logger.warn({
        eventName: EVENT_FAILED,
        error: error instanceof Error ? error.message : String(error),
        latencyMs: Date.now() - startedAt,
      });
      // See rationale above: prefer a non-escalating intent so a classifier
      // outage does not fire mass false-positive handoffs.
      return { intent: ChatIntent.SalesQuestion, useReferenceBank: false };
    }
  }

  private buildMessages(
    cleanedQuestion: string,
    history: ClassifierHistoryEntry[],
  ): LlmMessage[] {
    const messages: LlmMessage[] = [
      { role: 'system', content: CLASSIFIER_SYSTEM_PROMPT },
    ];
    const recent = history.slice(-MAX_HISTORY_TURNS);
    if (recent.length > 0) {
      const rendered = recent
        .map((entry) => {
          const label = entry.role === 'assistant' ? 'Ассистент' : 'Клиент';
          const text = (entry.content ?? '').trim().slice(0, MAX_HISTORY_CHARS_PER_TURN);
          return `${label}: ${text}`;
        })
        .join('\n');
      messages.push({
        role: 'user',
        content: `Последние реплики диалога (старые → новые):\n${rendered}`,
      });
    }
    messages.push({ role: 'user', content: `Новое сообщение клиента: ${cleanedQuestion}` });
    return messages;
  }

  private parseResponse(raw: string): ClassifiedIntent | null {
    if (!raw) return null;
    const stripped = raw
      .replace(/```json\s*/gi, '')
      .replace(/```/g, '')
      .trim();
    const start = stripped.indexOf('{');
    const end = stripped.lastIndexOf('}');
    if (start >= 0 && end > start) {
      const jsonSlice = stripped.slice(start, end + 1);
      try {
        const parsed = JSON.parse(jsonSlice);
        const intent = parseChatIntent(String(parsed?.intent ?? '')) ?? this.parseFuzzy(String(parsed?.intent ?? ''));
        if (!intent) return null;
        const useReferenceBank = parsed?.useReferenceBank === true;
        return { intent, useReferenceBank };
      } catch {
        // Fall through to fuzzy path — model returned something JSON-shaped
        // but not valid. Try to salvage the intent alone.
      }
    }
    const intent = parseChatIntent(stripped) ?? this.parseFuzzy(stripped);
    if (!intent) return null;
    // No structured signal on the bank flag — default to false so we don't
    // paste FAQ answers when the model produced a legacy-shaped response.
    return { intent, useReferenceBank: false };
  }

  private parseFuzzy(raw: string): ChatIntent | null {
    const lowered = raw.toLowerCase();
    let latestIndex = -1;
    let latestIntent: ChatIntent | null = null;
    for (const value of CHAT_INTENT_VALUES) {
      const rx = new RegExp(`(^|[^a-z_])${value}([^a-z_]|$)`);
      const match = rx.exec(lowered);
      if (match && match.index > latestIndex) {
        latestIndex = match.index;
        latestIntent = value;
      }
    }
    return latestIntent;
  }

  private readBoolean(key: string, fallback: boolean): boolean {
    const raw = this.configService?.get<string | boolean>(key);
    if (raw === undefined || raw === null || raw === '') return fallback;
    if (typeof raw === 'boolean') return raw;
    return String(raw).toLowerCase() === 'true';
  }
}
