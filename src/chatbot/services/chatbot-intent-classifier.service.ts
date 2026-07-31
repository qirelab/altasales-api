import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AgentId } from '../../ai/enums/agent-id.enum';
import { DataClass } from '../../ai/enums/data-class.enum';
import { LlmTask } from '../../ai/enums/llm-task.enum';
import { LlmProxyService } from '../../ai/llm-proxy.service';
import { CHAT_INTENT_VALUES, ChatIntent, parseChatIntent } from '../enums/chat-intent.enum';

const DEFAULT_ENABLED = true;
const MAX_QUESTION_CHARS = 800;
const EVENT_CLASSIFIED = 'CHATBOT_INTENT_CLASSIFIED';
const EVENT_FAILED = 'CHATBOT_INTENT_CLASSIFIER_FAILED';

const CLASSIFIER_SYSTEM_PROMPT = [
  'Ты классификатор намерений сообщений клиента в чате AltaSales.',
  'AltaSales — платформа рекомендаций и услуг для отделов продаж',
  '(построение отделов, обучение, экспертное сопровождение, найм).',
  '',
  'Верни РОВНО ОДНО слово из списка (без пояснений, без точек, без кавычек):',
  '',
  `- ${ChatIntent.Greeting} — приветствие, благодарность, прощание, короткая реплика без вопроса.`,
  `- ${ChatIntent.Meta} — вопрос про сам диалог: «что мы обсуждали», «повтори», «о чём мы говорили».`,
  `- ${ChatIntent.ExplicitHandoff} — прямая просьба соединить с человеком:`,
  '  «позовите менеджера», «хочу оператора», «свяжите со специалистом»,',
  '  «нужен живой человек».',
  `- ${ChatIntent.OffTopic} — тема вне AltaSales и вне продаж: политика, погода,`,
  '  спорт, анекдоты, философия, программирование, любые общие вопросы.',
  `- ${ChatIntent.PlatformQuestion} — вопрос про платформу, её услуги, пакеты,`,
  '  экспертов, оплату, аккаунт, рекомендации, статус заказов.',
  `- ${ChatIntent.SalesQuestion} — общий вопрос про построение или работу`,
  '  отдела продаж, не про конкретную услугу AltaSales: воронки, KPI,',
  '  найм, скрипты, работа с возражениями.',
  '',
  'Примеры:',
  `«Здравствуйте» → ${ChatIntent.Greeting}`,
  `«Спасибо, всё понятно» → ${ChatIntent.Greeting}`,
  `«О чём мы говорили выше» → ${ChatIntent.Meta}`,
  `«Позовите менеджера» → ${ChatIntent.ExplicitHandoff}`,
  `«Хочу поговорить с живым человеком» → ${ChatIntent.ExplicitHandoff}`,
  `«А можешь позвать менеджера?» → ${ChatIntent.ExplicitHandoff}`,
  `«Можешь соединить меня с оператором» → ${ChatIntent.ExplicitHandoff}`,
  `«Пусть ответит человек, а не бот» → ${ChatIntent.ExplicitHandoff}`,
  `«Переключи на специалиста» → ${ChatIntent.ExplicitHandoff}`,
  `«Мне нужен реальный сотрудник» → ${ChatIntent.ExplicitHandoff}`,
  `«Что ты думаешь о политике?» → ${ChatIntent.OffTopic}`,
  `«Какая сегодня погода в Москве» → ${ChatIntent.OffTopic}`,
  `«Расскажи анекдот» → ${ChatIntent.OffTopic}`,
  `«Что входит в пакет РОП» → ${ChatIntent.PlatformQuestion}`,
  `«Как оплатить с баланса» → ${ChatIntent.PlatformQuestion}`,
  `«Почему мне порекомендовали именно эту услугу» → ${ChatIntent.PlatformQuestion}`,
  `«Какие эксперты доступны для найма» → ${ChatIntent.PlatformQuestion}`,
  `«Какие условия возврата денег» → ${ChatIntent.PlatformQuestion}`,
  `«Есть ли у вас партнёрская программа» → ${ChatIntent.PlatformQuestion}`,
  `«Дадите ли вы скидку» → ${ChatIntent.PlatformQuestion}`,
  `«Какая у вас политика возврата» → ${ChatIntent.PlatformQuestion}`,
  `«Есть ли гарантия на услуги» → ${ChatIntent.PlatformQuestion}`,
  `«Как правильно строить воронку B2B» → ${ChatIntent.SalesQuestion}`,
  `«Как мотивировать менеджеров по продажам» → ${ChatIntent.SalesQuestion}`,
  `«Какие законы регулируют защиту персональных данных» → ${ChatIntent.OffTopic}`,
  `«Расскажи про amoCRM и Битрикс24, что лучше» → ${ChatIntent.OffTopic}`,
  '',
  'Если сомневаешься между platform_question и sales_question - выбирай platform_question.',
  'Если сомневаешься между off_topic и sales_question - выбирай sales_question.',
  'Если сомневаешься между off_topic и platform_question - выбирай off_topic.',
  'Это критично: false-positive platform → пустой RAG → напрасная эскалация команде.',
  'Вопросы про политики, условия, гарантии, возврат денег, скидки, партнёрские',
  'программы, лицензии, договоры AltaSales - всегда platform_question. Даже если',
  'вопрос кажется общим, речь всегда про правила именно нашей платформы.',
  'Никогда не выбирай explicit_handoff если клиент просто задаёт вопрос без',
  'просьбы соединить с человеком.',
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

  async classify(question: string): Promise<ChatIntent> {
    if (!this.enabled) return ChatIntent.PlatformQuestion;
    const cleaned = question.trim().slice(0, MAX_QUESTION_CHARS);
    if (!cleaned) return ChatIntent.Greeting;

    const startedAt = Date.now();
    try {
      const response = await this.llmProxy.chat({
        agentId: AgentId.Chatbot,
        task: LlmTask.Classify,
        declaredDataClass: DataClass.NoPii,
        messages: [
          { role: 'system', content: CLASSIFIER_SYSTEM_PROMPT },
          { role: 'user', content: cleaned },
        ],
      });
      const raw = response.content ?? '';
      const parsed = parseChatIntent(raw) ?? this.parseFuzzy(raw);
      // Fallback when the LLM answer can't be parsed: SalesQuestion, NOT
      // PlatformQuestion. PlatformQuestion + empty RAG triggers a handoff,
      // so an unparseable classifier response would systematically page
      // the AltaSales team for every off-topic user message during an
      // outage. SalesQuestion lets the LLM answer from general knowledge
      // without escalation — same policy as the LLM-throws catch below.
      const intent = parsed ?? ChatIntent.SalesQuestion;
      this.logger.log({
        eventName: EVENT_CLASSIFIED,
        intent,
        rawMatched: parsed !== null,
        latencyMs: Date.now() - startedAt,
      });
      return intent;
    } catch (error) {
      this.logger.warn({
        eventName: EVENT_FAILED,
        error: error instanceof Error ? error.message : String(error),
        latencyMs: Date.now() - startedAt,
      });
      // See rationale above: prefer a non-escalating intent so a classifier
      // outage does not fire mass false-positive handoffs.
      return ChatIntent.SalesQuestion;
    }
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
