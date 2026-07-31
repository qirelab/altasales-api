import { KnowledgeBasePurpose } from '../../knowledge/enums/knowledge-base-purpose.enum';
import { ChatIntent } from '../enums/chat-intent.enum';
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

async function* streamOf(chunks: string[]) {
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

function buildService(
  overrides: {
    searchResults?: ReturnType<typeof buildResultItem>[];
    streamChunks?: string[];
    streamError?: Error;
    intent?: ChatIntent;
  } = {},
) {
  const knowledgeSearch = {
    search: jest.fn().mockResolvedValue({
      results: overrides.searchResults ?? [buildResultItem()],
    }),
  };
  const chatStream = overrides.streamError
    ? makeThrowingStream(overrides.streamError)
    : makeChunkedStream(overrides.streamChunks ?? ['Готовый ', 'ответ.']);
  const llmProxy = {
    chatStream,
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
  const clientContext = {
    buildContextBlock: jest.fn().mockResolvedValue(''),
  };
  const intent = overrides.intent ?? ChatIntent.PlatformQuestion;
  const useReferenceBank = intent === ChatIntent.PlatformQuestion
    || intent === ChatIntent.Greeting;
  const intentClassifier = {
    classify: jest.fn().mockResolvedValue({ intent, useReferenceBank }),
  };
  const service = new ChatbotRagService(
    knowledgeSearch as never,
    llmProxy as never,
    conversationalContext as never,
    queryRewriter as never,
    clientContext as never,
    intentClassifier as never,
    undefined,
  );
  return { service, knowledgeSearch, llmProxy, intentClassifier };
}

function makeThrowingStream(error: Error) {
  return jest.fn(() => {
    throw error;
  });
}

function makeChunkedStream(chunks: string[]) {
  return jest.fn(() => streamOf(chunks));
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

    const events = await collect(
      service.askQuestionStream({ question: '   ' }),
    );

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'refusal',
      response: expect.objectContaining({
        refusalReason: 'empty_question',
        hasContext: false,
      }),
    });
  });

  it('for platform intent with empty RAG results, emits a no_results_in_scope refusal without streaming', async () => {
    const { service, llmProxy } = buildService({
      intent: ChatIntent.PlatformQuestion,
      searchResults: [],
    });

    const events = await collect(
      service.askQuestionStream({ question: 'unknown platform topic' }),
    );

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'refusal',
      response: expect.objectContaining({
        refusalReason: 'no_results_in_scope',
      }),
    });
    expect(llmProxy.chatStream).not.toHaveBeenCalled();
  });

  it('for meta intent with no reference match, searches then streams raw question through LLM', async () => {
    const { service, llmProxy, knowledgeSearch } = buildService({
      intent: ChatIntent.Meta,
      searchResults: [],
      streamChunks: ['Мы обсуждали ', 'пакет CRM.'],
    });

    const events = await collect(
      service.askQuestionStream({ question: 'Что мы обсуждали?' }),
    );

    expect(knowledgeSearch.search).toHaveBeenCalledTimes(1);
    expect(events[events.length - 1].type).toBe('done');
    expect(llmProxy.chatStream).toHaveBeenCalledTimes(1);
    const streamArg = llmProxy.chatStream.mock.calls[0][0];
    const lastMsg = streamArg.messages[streamArg.messages.length - 1];
    expect(lastMsg.content).toBe('Что мы обсуждали?');
  });

  it('for explicit_handoff intent, emits handoff refusal without any LLM call', async () => {
    const { service, llmProxy, knowledgeSearch } = buildService({
      intent: ChatIntent.ExplicitHandoff,
    });

    const events = await collect(
      service.askQuestionStream({ question: 'Позовите менеджера' }),
    );

    expect(knowledgeSearch.search).not.toHaveBeenCalled();
    expect(llmProxy.chatStream).not.toHaveBeenCalled();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'refusal',
      response: expect.objectContaining({
        refusalReason: 'explicit_handoff',
        intent: ChatIntent.ExplicitHandoff,
      }),
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

  it('forwards the AbortSignal to llmProxy.chatStream', async () => {
    const { service, llmProxy } = buildService();
    const controller = new AbortController();

    await collect(
      service.askQuestionStream({ question: 'ok?' }, controller.signal),
    );

    expect(llmProxy.chatStream).toHaveBeenCalledWith(
      expect.any(Object),
      controller.signal,
    );
  });
});
