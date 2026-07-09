import type { LlmMessage } from '../../ai/interfaces/llm-message.interface';
import { ChatbotQueryRewriterService } from './chatbot-query-rewriter.service';

function buildRewriter(opts: {
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
        content: opts.llmContent ?? 'Сколько стоит CRM Silver?',
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        dataClass: 'no_pii',
      }),
  };
  const configService = opts.config
    ? { get: jest.fn((key: string) => opts.config?.[key]) }
    : undefined;
  const service = new ChatbotQueryRewriterService(
    llmProxy as never,
    configService as never,
  );
  return { service, llmProxy };
}

const history: LlmMessage[] = [
  { role: 'user', content: 'Что такое CRM Silver?' },
  { role: 'assistant', content: 'CRM Silver — это пакет внедрения amoCRM с обучением.' },
];

describe('ChatbotQueryRewriterService', () => {
  it('returns original question when history is empty (no LLM call)', async () => {
    const { service, llmProxy } = buildRewriter();
    const result = await service.rewrite('Что такое CRM?', []);
    expect(result).toBe('Что такое CRM?');
    expect(llmProxy.chat).not.toHaveBeenCalled();
  });

  it('returns original question when disabled (no LLM call)', async () => {
    const { service, llmProxy } = buildRewriter({
      config: { CHATBOT_QUERY_REWRITE_ENABLED: 'false' },
    });
    const result = await service.rewrite('А сколько он стоит?', history);
    expect(result).toBe('А сколько он стоит?');
    expect(llmProxy.chat).not.toHaveBeenCalled();
  });

  it('rewrites a follow-up question using recent history', async () => {
    const { service, llmProxy } = buildRewriter({
      llmContent: 'Сколько стоит CRM Silver?',
    });
    const result = await service.rewrite('А сколько он стоит?', history);
    expect(result).toBe('Сколько стоит CRM Silver?');
    expect(llmProxy.chat).toHaveBeenCalledTimes(1);
    const call = llmProxy.chat.mock.calls[0][0];
    expect(call.messages[0].role).toBe('system');
    expect(call.messages[1].content).toContain('А сколько он стоит?');
    expect(call.messages[1].content).toContain('CRM Silver');
  });

  it('caps history to CHATBOT_QUERY_REWRITE_MAX_HISTORY_MESSAGES most recent', async () => {
    const long: LlmMessage[] = Array.from({ length: 20 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `msg-${i}`,
    }));
    const { service, llmProxy } = buildRewriter({
      config: { CHATBOT_QUERY_REWRITE_MAX_HISTORY_MESSAGES: 4 },
    });

    await service.rewrite('Follow-up', long);

    const call = llmProxy.chat.mock.calls[0][0];
    expect(call.messages[1].content).toContain('msg-16');
    expect(call.messages[1].content).toContain('msg-19');
    expect(call.messages[1].content).not.toContain('msg-15');
    expect(call.messages[1].content).not.toContain('msg-0');
  });

  it('fails open and returns original question when LLM throws', async () => {
    const { service } = buildRewriter({ llmError: new Error('LLM down') });
    const result = await service.rewrite('А сколько он стоит?', history);
    expect(result).toBe('А сколько он стоит?');
  });

  it('falls back to original question when rewrite returns whitespace', async () => {
    const { service } = buildRewriter({ llmContent: '   ' });
    const result = await service.rewrite('А сколько он стоит?', history);
    expect(result).toBe('А сколько он стоит?');
  });

  it('truncates an overly long rewrite to 300 chars', async () => {
    const long = 'а'.repeat(500);
    const { service } = buildRewriter({ llmContent: long });
    const result = await service.rewrite('follow-up', history);
    expect(result.length).toBe(300);
  });
});
