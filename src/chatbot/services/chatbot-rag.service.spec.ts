import { AgentId } from '../../ai/enums/agent-id.enum';
import { DataClass } from '../../ai/enums/data-class.enum';
import { LlmTask } from '../../ai/enums/llm-task.enum';
import {
  HANDOFF_ANNOUNCE_MESSAGE,
  HANDOFF_NO_CONTEXT_MESSAGE,
} from '../../chat/chat.constants';
import { KnowledgeBasePurpose } from '../../knowledge/enums/knowledge-base-purpose.enum';
import { ChatIntent } from '../enums/chat-intent.enum';
import { ChatbotRagService } from './chatbot-rag.service';

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

function buildService(
  overrides: {
    searchResults?: ReturnType<typeof buildResultItem>[];
    searchError?: Error;
    llmContent?: string;
    llmError?: Error;
    configOverrides?: Record<string, number | string>;
    historyMessages?: { role: 'user' | 'assistant'; content: string }[];
    rewrittenQuery?: string;
    intent?: ChatIntent;
  } = {},
) {
  const searchMock = jest.fn();
  if (overrides.searchError) {
    searchMock.mockRejectedValue(overrides.searchError);
  } else {
    searchMock.mockResolvedValue({
      results: overrides.searchResults ?? [buildResultItem()],
    });
  }
  const knowledgeSearch = { search: searchMock };

  const chatMock = jest.fn();
  if (overrides.llmError) {
    chatMock.mockRejectedValue(overrides.llmError);
  } else {
    chatMock.mockResolvedValue({
      providerId: 'mock',
      modelId: 'mock',
      content: overrides.llmContent ?? 'Готовый ответ от бота.',
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      dataClass: 'no_pii',
    });
  }
  const llmProxy = { chat: chatMock };
  const historyMessages = overrides.historyMessages ?? [];
  const conversationalContext = {
    build: jest.fn().mockReturnValue({
      historyMessages,
      usedHistoryCount: historyMessages.length,
    }),
  };
  const queryRewriter = {
    // Mirrors the real rewriter: return the original question unless a rewrite
    // is explicitly configured, so existing "no history" tests keep working.
    rewrite: jest.fn(
      async (question: string) => overrides.rewrittenQuery ?? question,
    ),
  };
  const configService = overrides.configOverrides
    ? { get: jest.fn((key: string) => overrides.configOverrides?.[key]) }
    : undefined;
  const clientContext = {
    buildContextBlock: jest.fn().mockResolvedValue(''),
  };
  const intent = overrides.intent ?? ChatIntent.PlatformQuestion;
  const intentClassifier = {
    classify: jest.fn().mockResolvedValue(intent),
  };
  const service = new ChatbotRagService(
    knowledgeSearch as never,
    llmProxy as never,
    conversationalContext as never,
    queryRewriter as never,
    clientContext as never,
    intentClassifier as never,
    configService as never,
  );
  return {
    service,
    knowledgeSearch,
    llmProxy,
    conversationalContext,
    queryRewriter,
    clientContext,
    intentClassifier,
  };
}

describe('ChatbotRagService', () => {
  it('runs retrieval → augmentation → LLM and returns the answer with sources', async () => {
    const { service, knowledgeSearch, llmProxy } = buildService({
      searchResults: [
        buildResultItem({
          chunkId: 'a',
          text: 'Пакет CRM Silver стоит 100 000 ₽.',
          score: 0.9,
        }),
        buildResultItem({
          chunkId: 'b',
          text: 'В пакет входит внедрение и обучение.',
          score: 0.7,
        }),
      ],
    });

    const result = await service.askQuestion({
      question: 'Сколько стоит CRM Silver?',
    });

    expect(knowledgeSearch.search).toHaveBeenCalledWith({
      purpose: KnowledgeBasePurpose.QA_CHATBOT,
      query: 'Сколько стоит CRM Silver?',
      limit: 6,
    });

    const chatArg = llmProxy.chat.mock.calls[0][0];
    expect(chatArg.agentId).toBe(AgentId.Chatbot);
    expect(chatArg.task).toBe(LlmTask.Reason);
    expect(chatArg.declaredDataClass).toBe(DataClass.NoPii);
    expect(chatArg.messages[0].role).toBe('system');
    // No history → augmented user prompt is the second (and last) message.
    expect(chatArg.messages).toHaveLength(2);
    expect(chatArg.messages[1].role).toBe('user');
    expect(chatArg.messages[1].content).toContain(
      'Пакет CRM Silver стоит 100 000 ₽.',
    );
    expect(chatArg.messages[1].content).toContain('Сколько стоит CRM Silver?');
    expect(chatArg.policy?.cacheTtlMs).toBeGreaterThan(0);

    expect(result.hasContext).toBe(true);
    expect(result.answer).toBe('Готовый ответ от бота.');
    expect(result.refusalReason).toBeUndefined();
    expect(result.sources).toHaveLength(2);
    expect(result.sources[0]).toEqual({
      documentId: 'doc-1',
      documentTitle: 'Guide',
      chunkIndex: 0,
      score: 0.9,
    });
  });

  it('splices history between system and augmented user prompt and uses rewritten query for retrieval', async () => {
    const {
      service,
      knowledgeSearch,
      llmProxy,
      conversationalContext,
      queryRewriter,
    } = buildService({
      historyMessages: [
        { role: 'user', content: 'Что такое CRM Silver?' },
        {
          role: 'assistant',
          content: 'CRM Silver — это пакет внедрения amoCRM.',
        },
      ],
      rewrittenQuery: 'Сколько стоит CRM Silver?',
    });

    await service.askQuestion({
      question: 'А сколько он стоит?',
      history: [
        { role: 'user', content: 'Что такое CRM Silver?' },
        {
          role: 'assistant',
          content: 'CRM Silver — это пакет внедрения amoCRM.',
        },
      ],
    });

    expect(conversationalContext.build).toHaveBeenCalledWith([
      { role: 'user', content: 'Что такое CRM Silver?' },
      {
        role: 'assistant',
        content: 'CRM Silver — это пакет внедрения amoCRM.',
      },
    ]);
    expect(queryRewriter.rewrite).toHaveBeenCalledWith('А сколько он стоит?', [
      { role: 'user', content: 'Что такое CRM Silver?' },
      {
        role: 'assistant',
        content: 'CRM Silver — это пакет внедрения amoCRM.',
      },
    ]);
    // Retrieval must use the rewritten (standalone) query.
    expect(knowledgeSearch.search).toHaveBeenCalledWith({
      purpose: KnowledgeBasePurpose.QA_CHATBOT,
      query: 'Сколько стоит CRM Silver?',
      limit: 6,
    });

    const chatArg = llmProxy.chat.mock.calls[0][0];
    // system + 2 history messages + augmented user
    expect(chatArg.messages).toHaveLength(4);
    expect(chatArg.messages[0].role).toBe('system');
    expect(chatArg.messages[1]).toEqual({
      role: 'user',
      content: 'Что такое CRM Silver?',
    });
    expect(chatArg.messages[2]).toEqual({
      role: 'assistant',
      content: 'CRM Silver — это пакет внедрения amoCRM.',
    });
    // The augmented user prompt still contains the ORIGINAL question, not the rewrite.
    expect(chatArg.messages[3].role).toBe('user');
    expect(chatArg.messages[3].content).toContain('А сколько он стоит?');
    expect(chatArg.messages[3].content).not.toContain(
      'Сколько стоит CRM Silver?',
    );
  });

  it('skips history entirely when input.history is not provided (backwards-compatible call)', async () => {
    const { service, llmProxy, conversationalContext, queryRewriter } =
      buildService();

    await service.askQuestion({ question: 'Что такое CRM?' });

    expect(conversationalContext.build).toHaveBeenCalledWith([]);
    // Rewriter is still invoked, but with empty history it returns the original query.
    expect(queryRewriter.rewrite).toHaveBeenCalledWith('Что такое CRM?', []);
    const chatArg = llmProxy.chat.mock.calls[0][0];
    expect(chatArg.messages).toHaveLength(2);
  });

  it('for meta intent, searches (for shortcut check) but calls LLM with raw question when no reference matches', async () => {
    const { service, llmProxy, knowledgeSearch } = buildService({
      intent: ChatIntent.Meta,
      searchResults: [],
    });

    const result = await service.askQuestion({ question: 'Что мы обсуждали?' });

    expect(knowledgeSearch.search).toHaveBeenCalledTimes(1);
    expect(llmProxy.chat).toHaveBeenCalledTimes(1);
    const chatArg = llmProxy.chat.mock.calls[0][0];
    const userMessage = chatArg.messages[chatArg.messages.length - 1];
    expect(userMessage.content).toBe('Что мы обсуждали?');
    expect(result.hasContext).toBe(false);
    expect(result.intent).toBe(ChatIntent.Meta);
  });

  it('for greeting intent, still searches for reference shortcut', async () => {
    const { service, llmProxy, knowledgeSearch } = buildService({
      intent: ChatIntent.Greeting,
      searchResults: [],
    });

    const result = await service.askQuestion({ question: 'Здравствуйте' });

    expect(knowledgeSearch.search).toHaveBeenCalledTimes(1);
    expect(llmProxy.chat).toHaveBeenCalledTimes(1);
    expect(result.intent).toBe(ChatIntent.Greeting);
  });

  it('for off_topic intent, still searches for reference shortcut (guards false-positive handoff)', async () => {
    const { service, llmProxy, knowledgeSearch } = buildService({
      intent: ChatIntent.OffTopic,
      searchResults: [],
    });

    const result = await service.askQuestion({
      question: 'Что ты думаешь о политике?',
    });

    expect(knowledgeSearch.search).toHaveBeenCalledTimes(1);
    expect(llmProxy.chat).toHaveBeenCalledTimes(1);
    expect(result.intent).toBe(ChatIntent.OffTopic);
    expect(result.refusalReason).toBeUndefined();
  });

  it('for sales_question intent, still searches for reference shortcut', async () => {
    const { service, llmProxy, knowledgeSearch } = buildService({
      intent: ChatIntent.SalesQuestion,
      searchResults: [],
    });

    const result = await service.askQuestion({
      question: 'Как построить воронку B2B продаж?',
    });

    expect(knowledgeSearch.search).toHaveBeenCalledTimes(1);
    expect(llmProxy.chat).toHaveBeenCalledTimes(1);
    expect(result.intent).toBe(ChatIntent.SalesQuestion);
    expect(result.refusalReason).toBeUndefined();
  });

  it('passes [Эталон] chunks to the LLM as RAG context instead of pasting them verbatim', async () => {
    // Curated reference chunks are no longer a deterministic shortcut - the
    // LLM sees them in the augmented prompt (in the "ЭТАЛОННЫЕ ОТВЕТЫ"
    // section) and decides paraphrase vs. near-verbatim based on the turn.
    const referenceText =
      'Вопрос: С кем я общаюсь?\nОтвет: Я цифровой эксперт AltaSales.\nТема: AI';
    const { service, llmProxy } = buildService({
      intent: ChatIntent.PlatformQuestion,
      searchResults: [
        buildResultItem({
          score: 0.9,
          text: referenceText,
          documentTitle: '[Эталон] AI: С кем я общаюсь?',
        }),
      ],
    });

    await service.askQuestion({ question: 'С кем я общаюсь?' });
    expect(llmProxy.chat).toHaveBeenCalledTimes(1);
    const call = llmProxy.chat.mock.calls[0][0];
    const userMessage = call.messages[call.messages.length - 1];
    expect(userMessage.content).toContain('ЭТАЛОННЫЕ ОТВЕТЫ');
    expect(userMessage.content).toContain('Я цифровой эксперт AltaSales.');
  });

  it('for platform intent with empty RAG results, refuses with no_results_in_scope and escalates', async () => {
    const { service, llmProxy } = buildService({
      intent: ChatIntent.PlatformQuestion,
      searchResults: [],
    });

    const result = await service.askQuestion({
      question: 'Какие условия возврата у пакета РОП?',
    });

    expect(llmProxy.chat).not.toHaveBeenCalled();
    expect(result.refusalReason).toBe('no_results_in_scope');
    expect(result.answer).toBe(HANDOFF_NO_CONTEXT_MESSAGE);
  });

  it('for platform intent with weak-score RAG results, still refuses with no_results_in_scope', async () => {
    const { service, llmProxy } = buildService({
      intent: ChatIntent.PlatformQuestion,
      searchResults: [
        buildResultItem({ score: 0.2 }),
        buildResultItem({ score: 0.1 }),
      ],
    });

    const result = await service.askQuestion({
      question: 'Есть ли пакет РОП?',
    });

    expect(llmProxy.chat).not.toHaveBeenCalled();
    expect(result.refusalReason).toBe('no_results_in_scope');
  });

  it('for explicit_handoff intent, returns the handoff message without RAG or LLM', async () => {
    const { service, knowledgeSearch, llmProxy } = buildService({
      intent: ChatIntent.ExplicitHandoff,
    });

    const result = await service.askQuestion({
      question: 'Позовите менеджера',
    });

    expect(knowledgeSearch.search).not.toHaveBeenCalled();
    expect(llmProxy.chat).not.toHaveBeenCalled();
    expect(result.refusalReason).toBe('explicit_handoff');
    expect(result.intent).toBe(ChatIntent.ExplicitHandoff);
    expect(result.answer).toBe(HANDOFF_ANNOUNCE_MESSAGE);
  });

  it('refuses with empty_question on empty question and skips classifier and retrieval', async () => {
    const { service, knowledgeSearch, llmProxy, intentClassifier } =
      buildService();

    const result = await service.askQuestion({ question: '   ' });

    expect(intentClassifier.classify).not.toHaveBeenCalled();
    expect(knowledgeSearch.search).not.toHaveBeenCalled();
    expect(llmProxy.chat).not.toHaveBeenCalled();
    expect(result.refusalReason).toBe('empty_question');
  });

  it('refuses with empty_llm_response and shows the infra message when the LLM returns whitespace', async () => {
    const { service } = buildService({ llmContent: '   ' });

    const result = await service.askQuestion({ question: 'Что такое CRM?' });

    expect(result.refusalReason).toBe('empty_llm_response');
    expect(result.hasContext).toBe(false);
    expect(result.answer).toContain('Что-то пошло не так');
  });

  it('refuses with retrieval_failed and shows the infra message when knowledge search throws', async () => {
    const { service, llmProxy } = buildService({
      searchError: new Error('Qdrant down'),
    });

    const result = await service.askQuestion({ question: 'Что такое CRM?' });

    expect(llmProxy.chat).not.toHaveBeenCalled();
    expect(result.refusalReason).toBe('retrieval_failed');
    expect(result.answer).toContain('Что-то пошло не так');
    expect(result.answer).toContain('задать вопрос ещё раз');
  });

  it('refuses with generation_failed and shows the infra message when LLM proxy throws', async () => {
    const { service } = buildService({
      llmError: new Error('LLM timeout'),
    });

    const result = await service.askQuestion({ question: 'Что такое CRM?' });

    expect(result.refusalReason).toBe('generation_failed');
    expect(result.answer).toContain('Что-то пошло не так');
  });

  it('picks only strong results but keeps them in original score order', async () => {
    const { service } = buildService({
      searchResults: [
        buildResultItem({ chunkId: 'a', score: 0.9, chunkIndex: 0 }),
        buildResultItem({ chunkId: 'b', score: 0.2, chunkIndex: 1 }),
        buildResultItem({ chunkId: 'c', score: 0.5, chunkIndex: 2 }),
      ],
    });

    const result = await service.askQuestion({ question: 'CRM?' });

    expect(result.sources.map((source) => source.chunkIndex)).toEqual([0, 2]);
  });

  it('trims oversized context: keeps highest-score chunks under the char budget', async () => {
    const bigText = 'x'.repeat(4000);
    // Budget: fits system prompt (~10KB after safety-phrases block) + one
    // 4KB chunk, but not two.
    const { service, llmProxy } = buildService({
      configOverrides: { CHATBOT_RAG_MAX_CONTEXT_CHARS: 15000 },
      searchResults: [
        buildResultItem({
          chunkId: 'top',
          score: 0.95,
          chunkIndex: 0,
          text: bigText,
        }),
        buildResultItem({
          chunkId: 'mid',
          score: 0.85,
          chunkIndex: 1,
          text: bigText,
        }),
        buildResultItem({
          chunkId: 'low',
          score: 0.75,
          chunkIndex: 2,
          text: bigText,
        }),
      ],
    });

    const result = await service.askQuestion({ question: 'Ok' });

    const chatArg = llmProxy.chat.mock.calls[0][0];
    expect(result.sources).toHaveLength(1);
    expect(result.sources[0].chunkIndex).toBe(0);
    expect(chatArg.messages[1].content.length).toBeLessThan(15_000);
  });

  it('refuses with context_too_large when the char budget cannot fit any chunk', async () => {
    const { service, llmProxy } = buildService({
      // System prompt alone is well over 500 chars; a 500-char budget can't fit a chunk.
      configOverrides: { CHATBOT_RAG_MAX_CONTEXT_CHARS: 500 },
      searchResults: [
        buildResultItem({
          chunkId: 'top',
          score: 0.95,
          text: 'x'.repeat(1000),
        }),
      ],
    });

    const result = await service.askQuestion({ question: 'Q' });

    expect(llmProxy.chat).not.toHaveBeenCalled();
    expect(result.refusalReason).toBe('context_too_large');
    expect(result.answer).toContain('Что-то пошло не так');
  });

  it('clips an oversize question to the max length before retrieval', async () => {
    const { service, knowledgeSearch } = buildService();

    await service.askQuestion({ question: 'a'.repeat(5_000) });

    const call = knowledgeSearch.search.mock.calls[0][0];
    expect(call.query.length).toBe(2_000);
  });

  it('respects env overrides for retrieval limit and threshold', async () => {
    const { service, knowledgeSearch, llmProxy } = buildService({
      configOverrides: {
        CHATBOT_RAG_RETRIEVAL_LIMIT: 3,
        CHATBOT_RAG_MIN_SCORE: 0.5,
      },
      searchResults: [
        buildResultItem({ chunkId: 'a', score: 0.6 }),
        buildResultItem({ chunkId: 'b', score: 0.4 }),
      ],
    });

    const result = await service.askQuestion({ question: 'Q' });

    expect(knowledgeSearch.search).toHaveBeenCalledWith({
      purpose: KnowledgeBasePurpose.QA_CHATBOT,
      query: 'Q',
      limit: 3,
    });
    expect(llmProxy.chat).toHaveBeenCalledTimes(1);
    expect(result.sources.map((s) => s.score)).toEqual([0.6]);
  });

  it('accepts MIN_SCORE=0 as a valid threshold that disables filtering', async () => {
    const { service, llmProxy } = buildService({
      configOverrides: { CHATBOT_RAG_MIN_SCORE: 0 },
      searchResults: [
        buildResultItem({ chunkId: 'a', score: 0.02 }),
        buildResultItem({ chunkId: 'b', score: 0.0 }),
      ],
    });

    const result = await service.askQuestion({ question: 'Q' });

    expect(llmProxy.chat).toHaveBeenCalledTimes(1);
    expect(result.hasContext).toBe(true);
    expect(result.sources).toHaveLength(2);
  });

  it('forwards CHATBOT_RAG_CACHE_TTL_MS into the LLM policy', async () => {
    const { service, llmProxy } = buildService({
      configOverrides: { CHATBOT_RAG_CACHE_TTL_MS: 30_000 },
    });

    await service.askQuestion({ question: 'Q' });

    const chatArg = llmProxy.chat.mock.calls[0][0];
    expect(chatArg.policy?.cacheTtlMs).toBe(30_000);
  });
});
