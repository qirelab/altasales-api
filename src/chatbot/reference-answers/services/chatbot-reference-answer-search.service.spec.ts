import { ChatbotReferenceAnswerSearchService } from './chatbot-reference-answer-search.service';
import { ReferenceAnswerStatus } from '../enums/reference-answer-status.enum';

function buildSearchService(opts: {
  vectorResults?: { referenceAnswerId: string; score: number }[];
  activeIds?: string[];
} = {}) {
  const embeddingProxy = {
    embed: jest.fn().mockResolvedValue({
      providerId: 'mock',
      modelId: 'mock',
      vectors: [Array.from({ length: 1536 }, () => 0.1)],
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      dimensions: 1536,
      dataClass: 'no_pii',
    }),
  };
  const vectorStore = {
    search: jest.fn().mockResolvedValue(opts.vectorResults ?? []),
    ensureCollection: jest.fn(),
    upsertOne: jest.fn(),
    deleteById: jest.fn(),
  };
  const activeIds = new Set(opts.activeIds ?? []);
  const repository = {
    find: jest.fn(async ({ where }) => {
      const ids = where.id?._value ?? [];
      return ids
        .filter((id: string) => activeIds.has(id))
        .map((id: string) => ({
          id,
          question: `q-${id}`,
          answer: `a-${id}`,
          topic: 'topic',
          status: ReferenceAnswerStatus.ACTIVE,
        }));
    }),
  };
  const service = new ChatbotReferenceAnswerSearchService(
    embeddingProxy as never,
    vectorStore as never,
    repository as never,
  );
  return { service, embeddingProxy, vectorStore, repository };
}

describe('ChatbotReferenceAnswerSearchService', () => {
  it('returns [] on empty question', async () => {
    const { service, embeddingProxy } = buildSearchService();
    const result = await service.searchSimilar({ question: '   ', limit: 3, minScore: 0.5 });
    expect(result).toEqual([]);
    expect(embeddingProxy.embed).not.toHaveBeenCalled();
  });

  it('returns [] when limit <= 0', async () => {
    const { service, embeddingProxy } = buildSearchService();
    const result = await service.searchSimilar({ question: 'Q', limit: 0, minScore: 0.5 });
    expect(result).toEqual([]);
    expect(embeddingProxy.embed).not.toHaveBeenCalled();
  });

  it('filters vector hits below minScore', async () => {
    const { service } = buildSearchService({
      vectorResults: [
        { referenceAnswerId: 'a', score: 0.9 },
        { referenceAnswerId: 'b', score: 0.4 },
      ],
      activeIds: ['a', 'b'],
    });
    const result = await service.searchSimilar({ question: 'Q', limit: 3, minScore: 0.5 });
    expect(result).toHaveLength(1);
    expect(result[0].referenceAnswer.id).toBe('a');
  });

  it('drops results whose reference answer is missing or archived', async () => {
    const { service } = buildSearchService({
      vectorResults: [
        { referenceAnswerId: 'a', score: 0.9 },
        { referenceAnswerId: 'gone', score: 0.85 },
      ],
      activeIds: ['a'],
    });
    const result = await service.searchSimilar({ question: 'Q', limit: 3, minScore: 0.5 });
    expect(result.map((r) => r.referenceAnswer.id)).toEqual(['a']);
  });

  it('preserves vector-store score ordering', async () => {
    const { service } = buildSearchService({
      vectorResults: [
        { referenceAnswerId: 'a', score: 0.95 },
        { referenceAnswerId: 'b', score: 0.7 },
      ],
      activeIds: ['a', 'b'],
    });
    const result = await service.searchSimilar({ question: 'Q', limit: 3, minScore: 0.5 });
    expect(result.map((r) => r.score)).toEqual([0.95, 0.7]);
  });
});
