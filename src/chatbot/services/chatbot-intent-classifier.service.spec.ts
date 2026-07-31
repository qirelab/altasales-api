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
        content: opts.llmContent ?? ChatIntent.PlatformQuestion,
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
  ])('returns %s when LLM answers with the exact label', async (intent) => {
    const { service } = buildClassifier({ llmContent: intent });
    await expect(service.classify('any question')).resolves.toBe(intent);
  });

  it('trims whitespace and casing from the LLM answer', async () => {
    const { service } = buildClassifier({ llmContent: '  Platform_Question  ' });
    await expect(service.classify('Сколько стоит пакет?')).resolves.toBe(
      ChatIntent.PlatformQuestion,
    );
  });

  it('parses fuzzy answers like "The intent is off_topic."', async () => {
    const { service } = buildClassifier({ llmContent: 'The intent is off_topic.' });
    await expect(service.classify('Что о политике?')).resolves.toBe(ChatIntent.OffTopic);
  });

  it('falls back to platform_question when LLM returns unrecognised content', async () => {
    const { service } = buildClassifier({ llmContent: 'i-have-no-idea' });
    await expect(service.classify('Странный вопрос')).resolves.toBe(
      ChatIntent.PlatformQuestion,
    );
  });

  it('falls back to platform_question when LLM throws', async () => {
    const { service, llmProxy } = buildClassifier({ llmError: new Error('rate limit') });
    await expect(service.classify('Что входит в пакет?')).resolves.toBe(
      ChatIntent.PlatformQuestion,
    );
    expect(llmProxy.chat).toHaveBeenCalledTimes(1);
  });

  it('returns greeting for empty question without calling LLM', async () => {
    const { service, llmProxy } = buildClassifier();
    await expect(service.classify('   ')).resolves.toBe(ChatIntent.Greeting);
    expect(llmProxy.chat).not.toHaveBeenCalled();
  });

  it('returns platform_question without calling LLM when disabled', async () => {
    const { service, llmProxy } = buildClassifier({
      config: { CHATBOT_INTENT_CLASSIFIER_ENABLED: 'false' },
    });
    await expect(service.classify('Что о погоде?')).resolves.toBe(
      ChatIntent.PlatformQuestion,
    );
    expect(llmProxy.chat).not.toHaveBeenCalled();
  });

  it('caps question length to 800 chars before sending to LLM', async () => {
    const long = 'а'.repeat(2_000);
    const { service, llmProxy } = buildClassifier({ llmContent: ChatIntent.OffTopic });
    await service.classify(long);
    const call = llmProxy.chat.mock.calls[0][0];
    const userMessage = call.messages[call.messages.length - 1];
    expect(userMessage.content.length).toBe(800);
  });
});
