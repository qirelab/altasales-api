import { ChatbotReferenceInjectionService } from './chatbot-reference-injection.service';

function buildInjection(opts: {
  searchResults?: { referenceAnswer: { id: string; question: string; answer: string }; score: number }[];
  searchError?: Error;
  config?: Record<string, string | number | boolean>;
} = {}) {
  const search = {
    searchSimilar: opts.searchError
      ? jest.fn().mockRejectedValue(opts.searchError)
      : jest.fn().mockResolvedValue(opts.searchResults ?? []),
  };
  const configService = opts.config
    ? { get: jest.fn((key: string) => opts.config?.[key]) }
    : undefined;
  const service = new ChatbotReferenceInjectionService(
    search as never,
    configService as never,
  );
  return { service, search };
}

describe('ChatbotReferenceInjectionService', () => {
  it('returns null block when injection disabled', async () => {
    const { service, search } = buildInjection({
      config: { CHATBOT_REFERENCE_INJECTION_ENABLED: 'false' },
    });
    const result = await service.getInjection('Q');
    expect(result).toEqual({ block: null, usedCount: 0 });
    expect(search.searchSimilar).not.toHaveBeenCalled();
  });

  it('returns null block when search returns no results', async () => {
    const { service } = buildInjection({ searchResults: [] });
    const result = await service.getInjection('Q');
    expect(result).toEqual({ block: null, usedCount: 0 });
  });

  it('formats few-shot block with numbered examples', async () => {
    const { service } = buildInjection({
      searchResults: [
        { referenceAnswer: { id: 'a', question: 'Q1?', answer: 'A1' }, score: 0.9 },
        { referenceAnswer: { id: 'b', question: 'Q2?', answer: 'A2' }, score: 0.7 },
      ],
    });
    const result = await service.getInjection('Q');
    expect(result.block).toContain('Примеры ответов менеджеров');
    expect(result.block).toContain('Пример 1:');
    expect(result.block).toContain('Q: Q1?');
    expect(result.block).toContain('A: A1');
    expect(result.block).toContain('Пример 2:');
    expect(result.usedCount).toBe(2);
    expect(result.topScore).toBe(0.9);
  });

  it('passes env-driven limit and minScore to search', async () => {
    const { service, search } = buildInjection({
      config: { CHATBOT_REFERENCE_RETRIEVAL_LIMIT: '5', CHATBOT_REFERENCE_MIN_SCORE: '0.8' },
    });
    await service.getInjection('Q');
    expect(search.searchSimilar).toHaveBeenCalledWith({
      question: 'Q',
      limit: 5,
      minScore: 0.8,
    });
  });

  it('gracefully degrades when search throws', async () => {
    const { service } = buildInjection({ searchError: new Error('Qdrant down') });
    const result = await service.getInjection('Q');
    expect(result).toEqual({ block: null, usedCount: 0 });
  });
});
