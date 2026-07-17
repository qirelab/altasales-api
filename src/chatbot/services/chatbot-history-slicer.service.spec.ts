import { ChatbotHistorySlicerService } from './chatbot-history-slicer.service';

function buildSlicer(config?: Record<string, string | number>) {
  const configService = config
    ? { get: jest.fn((key: string) => config[key]) }
    : undefined;
  return new ChatbotHistorySlicerService(configService as never);
}

function m(role: 'user' | 'assistant', content: string) {
  return { role, content };
}

describe('ChatbotHistorySlicerService', () => {
  it('returns empty for empty input', () => {
    expect(buildSlicer().slice([])).toEqual([]);
  });

  it('keeps chronological order and returns everything if under limits', () => {
    const messages = [
      m('user', 'q1'),
      m('assistant', 'a1'),
      m('user', 'q2'),
    ];
    const result = buildSlicer().slice(messages);
    expect(result).toEqual(messages);
  });

  it('keeps only the last N messages when max_messages is exceeded', () => {
    const messages = Array.from({ length: 12 }, (_, i) =>
      m(i % 2 ? 'assistant' : 'user', `m${i}`),
    );
    const result = buildSlicer({ CHATBOT_HISTORY_MAX_MESSAGES: 4 }).slice(messages);
    expect(result.map((r) => r.content)).toEqual(['m8', 'm9', 'm10', 'm11']);
  });

  it('stops accumulating once char budget is hit (keeps at least the newest message)', () => {
    const big = 'x'.repeat(6000);
    const messages = [
      m('user', 'old'),
      m('assistant', big),
    ];
    const result = buildSlicer({ CHATBOT_HISTORY_MAX_CHARS: 1000 }).slice(messages);
    expect(result).toHaveLength(1);
    expect(result[0].content).toBe(big);
  });

  it('respects env-driven message limit', () => {
    const messages = Array.from({ length: 3 }, (_, i) => m('user', `m${i}`));
    const result = buildSlicer({ CHATBOT_HISTORY_MAX_MESSAGES: 2 }).slice(messages);
    expect(result.map((r) => r.content)).toEqual(['m1', 'm2']);
  });

  it('keeps everything when count equals max_messages (boundary)', () => {
    const messages = Array.from({ length: 4 }, (_, i) => m('user', `m${i}`));
    const result = buildSlicer({ CHATBOT_HISTORY_MAX_MESSAGES: 4 }).slice(messages);
    expect(result.map((r) => r.content)).toEqual(['m0', 'm1', 'm2', 'm3']);
  });

  it('is generic over the message shape (preserves extra fields)', () => {
    const messages = [
      { role: 'user' as const, content: 'q1', id: 'msg-1' },
      { role: 'assistant' as const, content: 'a1', id: 'msg-2' },
    ];
    const result = buildSlicer().slice(messages);
    expect(result).toEqual(messages);
  });
});
