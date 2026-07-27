import { KnowledgeBasePurpose } from '../../knowledge/enums/knowledge-base-purpose.enum';
import {
  ChatbotRagService,
  ChatbotRagStreamEvent,
} from './chatbot-rag.service';

function buildResultItem(
  overrides: Partial<{
    chunkId: string;
    documentId: string;
    score: number;
    text: string;
    chunkIndex: number;
    documentTitle: string | null;
    originalFileName: string;
  }> = {},
) {
  return {
    chunkId: overrides.chunkId ?? 'chunk-1',
    documentId: overrides.documentId ?? 'doc-1',
    text: overrides.text ?? 'Sample knowledge text',
    score: overrides.score ?? 0.9,
    chunkIndex: overrides.chunkIndex ?? 0,
    metadata: {},
    document: {
      id: overrides.documentId ?? 'doc-1',
      title: overrides.documentTitle ?? 'Guide',
      purpose: KnowledgeBasePurpose.QA_CHATBOT,
      mimeType: 'text/plain',
      originalFileName: overrides.originalFileName ?? 'guide.txt',
    },
  };
}

async function *streamOf(chunks: string[]) {
  for (const content of chunks) {
    yield { type: 'delta' as const, content };
  }
  yield {
    type: 'done' as const,
    response: {
      providerId: 'mock',
      modelId: 'mock',
      content: chunks.join(''),
      usage: { tokensIn: 0, tokensOut: 0, costRub: 0, latencyMs: 1 },
      dataClass: 'no_pii' as never,
    },
  };
}

function buildService(overrides: {
  searchResults?: ReturnType<typeof buildResultItem>[];
  streamChunks?: string[];
  streamError?: Error;
} = {}) {
  const knowledgeSearch = {
    search: jest.fn().mockResolvedValue({
      results: overrides.searchResults ?? [buildResultItem()],
    }),
  };
  const llmProxy = {
    chatStream: overrides.streamError
      ? jest.fn(() => {
        throw overrides.streamError as Error;
      })
      : jest.fn(() => streamOf(overrides.streamChunks ?? ['Готовый ', 'ответ.'])),
    chat: jest.fn(),
  };
  const conversationalContext = {
    build: jest.fn().mockReturnValue({
      historyMessages: [],
      usedHistoryCount: 0,
    }),
  };
  const queryRewriter = {
    rewrite: jest.fn(async (question: string) => question),
  };
  const service = new ChatbotRagService(
    knowledgeSearch as never,
    llmProxy as never,
    conversationalContext as never,
    queryRewriter as never,
    undefined,
  );
  return { service, knowledgeSearch, llmProxy };
}

async function collect(
  stream: AsyncGenerator<ChatbotRagStreamEvent>,
): Promise<ChatbotRagStreamEvent[]> {
  const events: ChatbotRagStreamEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

describe('ChatbotRagService.askQuestionStream', () => {
  it('emits deltas from the LLM stream followed by a done event with sources', async () => {
    const { service, llmProxy } = buildService({
      streamChunks: ['Пакет ', 'CRM ', 'Silver.'],
    });

    const events = await collect(
      service.askQuestionStream({ question: 'Что за пакет?' }),
    );

    expect(events[0]).toEqual({ type: 'delta', content: 'Пакет ' });
    expect(events[1]).toEqual({ type: 'delta', content: 'CRM ' });
    expect(events[2]).toEqual({ type: 'delta', content: 'Silver.' });
    expect(events[3]).toMatchObject({
      type: 'done',
      response: expect.objectContaining({
        answer: 'Пакет CRM Silver.',
        hasContext: true,
        sources: expect.arrayContaining([
          expect.objectContaining({ documentId: 'doc-1' }),
        ]),
      }),
    });
    expect(llmProxy.chatStream).toHaveBeenCalledTimes(1);
    expect(llmProxy.chat).not.toHaveBeenCalled();
  });

  it('yields a single refusal event when the question is empty', async () => {
    const { service } = buildService();

    const events = await collect(service.askQuestionStream({ question: '   ' }));

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'refusal',
      response: expect.objectContaining({
        refusalReason: 'empty_question',
        hasContext: false,
      }),
    });
  });

  it('emits a refusal when retrieval returns no matches', async () => {
    const { service } = buildService({ searchResults: [] });

    const events = await collect(
      service.askQuestionStream({ question: 'unknown topic' }),
    );

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'refusal',
      response: expect.objectContaining({ refusalReason: 'no_results' }),
    });
  });

  it('emits a refusal (generation_failed) when the LLM stream throws', async () => {
    const { service } = buildService({
      streamError: new Error('boom'),
    });

    const events = await collect(
      service.askQuestionStream({ question: 'Что за пакет?' }),
    );

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'refusal',
      response: expect.objectContaining({ refusalReason: 'generation_failed' }),
    });
  });
});
