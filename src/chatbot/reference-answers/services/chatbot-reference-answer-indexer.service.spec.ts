import { ChatbotReferenceAnswerIndexerService } from './chatbot-reference-answer-indexer.service';

function buildIndexer(opts: {
  embedError?: Error;
  upsertError?: Error;
  deleteError?: Error;
} = {}) {
  const embeddingProxy = {
    embed: opts.embedError
      ? jest.fn().mockRejectedValue(opts.embedError)
      : jest.fn().mockResolvedValue({
        providerId: 'mock',
        modelId: 'mock',
        vectors: [Array.from({ length: 1536 }, () => 0.1)],
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        dimensions: 1536,
        dataClass: 'no_pii',
      }),
  };
  const vectorStore = {
    ensureCollection: jest.fn().mockResolvedValue(undefined),
    upsertOne: opts.upsertError
      ? jest.fn().mockRejectedValue(opts.upsertError)
      : jest.fn().mockResolvedValue(undefined),
    deleteById: opts.deleteError
      ? jest.fn().mockRejectedValue(opts.deleteError)
      : jest.fn().mockResolvedValue(undefined),
    search: jest.fn(),
  };
  const service = new ChatbotReferenceAnswerIndexerService(
    embeddingProxy as never,
    vectorStore as never,
  );
  return { service, embeddingProxy, vectorStore };
}

const sample = { id: 'ref-1', question: 'Q?', topic: 'T' };

describe('ChatbotReferenceAnswerIndexerService', () => {
  it('ensures collection, embeds question, and upserts vector', async () => {
    const { service, embeddingProxy, vectorStore } = buildIndexer();
    await service.index(sample as never);

    expect(vectorStore.ensureCollection).toHaveBeenCalled();
    expect(embeddingProxy.embed).toHaveBeenCalledWith({
      inputs: ['Q?'],
      declaredDataClass: 'no_pii',
    });
    expect(vectorStore.upsertOne).toHaveBeenCalledWith(sample, expect.any(Array));
  });

  it('throws when embedding returns no vector', async () => {
    const { service, embeddingProxy } = buildIndexer();
    embeddingProxy.embed.mockResolvedValueOnce({
      providerId: 'mock',
      modelId: 'mock',
      vectors: [],
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      dimensions: 1536,
      dataClass: 'no_pii',
    });
    await expect(service.index(sample as never)).rejects.toThrow(
      'Reference answer embedding is empty',
    );
  });

  it('safeIndex swallows errors and does not throw', async () => {
    const { service } = buildIndexer({ upsertError: new Error('upstream fail') });
    await expect(service.safeIndex(sample as never)).resolves.toBeUndefined();
  });

  it('safeRemove swallows errors and does not throw', async () => {
    const { service } = buildIndexer({ deleteError: new Error('upstream fail') });
    await expect(service.safeRemove('ref-1')).resolves.toBeUndefined();
  });

  it('remove delegates to vectorStore.deleteById', async () => {
    const { service, vectorStore } = buildIndexer();
    await service.remove('ref-42');
    expect(vectorStore.deleteById).toHaveBeenCalledWith('ref-42');
  });
});
