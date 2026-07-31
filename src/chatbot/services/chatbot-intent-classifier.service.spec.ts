import { ChatIntent } from '../enums/chat-intent.enum';
import { ChatbotIntentClassifierService } from './chatbot-intent-classifier.service';

function buildClassifier(opts: {
  llmContent?: string;
  llmError?: Error;
  config?: Record<string, string | number | boolean>;
} = {}) {
  const llmProxy = {
    chat: opts.llmError
      ? jest.fn().mockRejectedValue(opts.llmError)
      : jest.fn().mockResolvedValue({
        providerId: 'mock',
        modelId: 'mock',
        content: opts.llmContent
          ?? `{"intent":"${ChatIntent.PlatformQuestion}","useReferenceBank":true}`,
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        dataClass: 'no_pii',
      }),
  };
  const configService = opts.config
    ? { get: jest.fn((key: string) => opts.config?.[key]) }
    : undefined;
  const service = new ChatbotIntentClassifierService(
    llmProxy as never,
    configService as never,
  );
  return { service, llmProxy };
}

describe('ChatbotIntentClassifierService', () => {
  it.each([
    [ChatIntent.Greeting],
    [ChatIntent.Meta],
    [ChatIntent.ExplicitHandoff],
    [ChatIntent.OffTopic],
    [ChatIntent.PlatformQuestion],
    [ChatIntent.SalesQuestion],
  ])('parses %s from a JSON classifier answer', async (intent) => {
    const { service } = buildClassifier({
      llmContent: `{"intent":"${intent}","useReferenceBank":false}`,
    });
    await expect(service.classify('any question')).resolves.toEqual({
      intent,
      useReferenceBank: false,
    });
  });

  it('reflects useReferenceBank=true when the JSON answer sets it', async () => {
    const { service } = buildClassifier({
      llmContent: `{"intent":"${ChatIntent.PlatformQuestion}","useReferenceBank":true}`,
    });
    await expect(service.classify('Что входит в пакет РОП?')).resolves.toEqual({
      intent: ChatIntent.PlatformQuestion,
      useReferenceBank: true,
    });
  });

  it('strips ```json``` fences before parsing', async () => {
    const { service } = buildClassifier({
      llmContent: '```json\n{"intent":"platform_question","useReferenceBank":false}\n```',
    });
    await expect(service.classify('Как оплатить?')).resolves.toEqual({
      intent: ChatIntent.PlatformQuestion,
      useReferenceBank: false,
    });
  });

  it('accepts a legacy bare intent answer with useReferenceBank defaulting to false', async () => {
    const { service } = buildClassifier({ llmContent: '  Platform_Question  ' });
    await expect(service.classify('Сколько стоит пакет?')).resolves.toEqual({
      intent: ChatIntent.PlatformQuestion,
      useReferenceBank: false,
    });
  });

  it('parses fuzzy answers like "The intent is off_topic."', async () => {
    const { service } = buildClassifier({ llmContent: 'The intent is off_topic.' });
    await expect(service.classify('Что о политике?')).resolves.toEqual({
      intent: ChatIntent.OffTopic,
      useReferenceBank: false,
    });
  });

  it('falls back to sales_question + no bank when LLM returns unparseable content', async () => {
    const { service } = buildClassifier({ llmContent: 'i-have-no-idea' });
    await expect(service.classify('Странный вопрос')).resolves.toEqual({
      intent: ChatIntent.SalesQuestion,
      useReferenceBank: false,
    });
  });

  it('falls back to sales_question + no bank when LLM throws', async () => {
    const { service, llmProxy } = buildClassifier({ llmError: new Error('rate limit') });
    await expect(service.classify('Что входит в пакет?')).resolves.toEqual({
      intent: ChatIntent.SalesQuestion,
      useReferenceBank: false,
    });
    expect(llmProxy.chat).toHaveBeenCalledTimes(1);
  });

  it('returns greeting + no bank for empty question without calling LLM', async () => {
    const { service, llmProxy } = buildClassifier();
    await expect(service.classify('   ')).resolves.toEqual({
      intent: ChatIntent.Greeting,
      useReferenceBank: false,
    });
    expect(llmProxy.chat).not.toHaveBeenCalled();
  });

  it('returns platform_question + no bank without calling LLM when disabled', async () => {
    const { service, llmProxy } = buildClassifier({
      config: { CHATBOT_INTENT_CLASSIFIER_ENABLED: 'false' },
    });
    await expect(service.classify('Что о погоде?')).resolves.toEqual({
      intent: ChatIntent.PlatformQuestion,
      useReferenceBank: false,
    });
    expect(llmProxy.chat).not.toHaveBeenCalled();
  });

  it('caps question length to 800 chars before sending to LLM', async () => {
    const long = 'а'.repeat(2_000);
    const { service, llmProxy } = buildClassifier({
      llmContent: `{"intent":"${ChatIntent.OffTopic}","useReferenceBank":false}`,
    });
    await service.classify(long);
    const call = llmProxy.chat.mock.calls[0][0];
    const userMessage = call.messages[call.messages.length - 1];
    // Prefix "Новое сообщение клиента: " + 800 chars of question
    expect(userMessage.content).toContain('Новое сообщение клиента:');
    expect(userMessage.content.length).toBeGreaterThan(800);
    expect(userMessage.content.length).toBeLessThan(1_000);
  });

  it('appends the last few history turns as a separate user message for context', async () => {
    const { service, llmProxy } = buildClassifier({
      llmContent: `{"intent":"${ChatIntent.PlatformQuestion}","useReferenceBank":false}`,
    });
    await service.classify('то есть ты профессионал?', [
      { role: 'user', content: 'кто вы такие?' },
      { role: 'assistant', content: 'Мы платформа услуг для отделов продаж.' },
    ]);
    const call = llmProxy.chat.mock.calls[0][0];
    expect(call.messages).toHaveLength(3); // system + history + current
    expect(call.messages[1].content).toContain('Ассистент:');
    expect(call.messages[1].content).toContain('Клиент:');
    expect(call.messages[2].content).toContain('то есть ты профессионал?');
  });
});
