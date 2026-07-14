import { AgentId } from '../../ai/enums/agent-id.enum';
import { DataClass } from '../../ai/enums/data-class.enum';
import { LlmTask } from '../../ai/enums/llm-task.enum';
import { KnowledgeBasePurpose } from '../../knowledge/enums/knowledge-base-purpose.enum';
import { ChatbotRagService } from './chatbot-rag.service';

function buildResultItem(overrides: Partial<{
  chunkId: string;
  documentId: string;
  score: number;
  text: string;
  chunkIndex: number;
  documentTitle: string | null;
  originalFileName: string;
}> = {}) {
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

function buildService(overrides: {
  searchResults?: ReturnType<typeof buildResultItem>[];
  searchError?: Error;
  llmContent?: string;
  llmError?: Error;
  configOverrides?: Record<string, number | string>;
} = {}) {
  const knowledgeSearch = {
    search: overrides.searchError
      ? jest.fn().mockRejectedValue(overrides.searchError)
      : jest.fn().mockResolvedValue({
        results: overrides.searchResults ?? [buildResultItem()],
      }),
  };
  const llmProxy = {
    chat: overrides.llmError
      ? jest.fn().mockRejectedValue(overrides.llmError)
      : jest.fn().mockResolvedValue({
        providerId: 'mock',
        modelId: 'mock',
        content: overrides.llmContent ?? 'Готовый ответ от бота.',
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        dataClass: 'no_pii',
      }),
  };
  const configService = overrides.configOverrides
    ? { get: jest.fn((key: string) => overrides.configOverrides?.[key]) }
    : undefined;
  const service = new ChatbotRagService(
    knowledgeSearch as never,
    llmProxy as never,
    configService as never,
  );
  return { service, knowledgeSearch, llmProxy };
}

describe('ChatbotRagService', () => {
  it('runs retrieval → augmentation → LLM and returns the answer with sources', async () => {
    const { service, knowledgeSearch, llmProxy } = buildService({
      searchResults: [
        buildResultItem({ chunkId: 'a', text: 'Пакет CRM Silver стоит 100 000 ₽.', score: 0.9 }),
        buildResultItem({ chunkId: 'b', text: 'В пакет входит внедрение и обучение.', score: 0.7 }),
      ],
    });

    const result = await service.askQuestion({ question: 'Сколько стоит CRM Silver?' });

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
    expect(chatArg.messages[1].role).toBe('user');
    expect(chatArg.messages[1].content).toContain('Пакет CRM Silver стоит 100 000 ₽.');
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

  it('refuses with no_results and shows the no-info message when knowledge search returns nothing', async () => {
    const { service, llmProxy } = buildService({ searchResults: [] });

    const result = await service.askQuestion({ question: 'Странный вопрос' });

    expect(llmProxy.chat).not.toHaveBeenCalled();
    expect(result.hasContext).toBe(false);
    expect(result.refusalReason).toBe('no_results');
    expect(result.answer).toContain('Я не нашёл информации');
    expect(result.answer).toContain('чат «Помощь»');
  });

  it('refuses with below_threshold when all results are below the relevance threshold', async () => {
    const { service, llmProxy } = buildService({
      searchResults: [
        buildResultItem({ score: 0.2 }),
        buildResultItem({ score: 0.1 }),
      ],
    });

    const result = await service.askQuestion({ question: 'Что-то нерелевантное' });

    expect(llmProxy.chat).not.toHaveBeenCalled();
    expect(result.refusalReason).toBe('below_threshold');
    expect(result.answer).toContain('Я не нашёл информации');
  });

  it('refuses with empty_question on empty question and skips retrieval', async () => {
    const { service, knowledgeSearch, llmProxy } = buildService();

    const result = await service.askQuestion({ question: '   ' });

    expect(knowledgeSearch.search).not.toHaveBeenCalled();
    expect(llmProxy.chat).not.toHaveBeenCalled();
    expect(result.refusalReason).toBe('empty_question');
    expect(result.answer).toContain('Я не нашёл информации');
  });

  it('refuses with empty_llm_response and shows the infra message when the LLM returns whitespace', async () => {
    const { service } = buildService({ llmContent: '   ' });

    const result = await service.askQuestion({ question: 'Что такое CRM?' });

    expect(result.refusalReason).toBe('empty_llm_response');
    expect(result.hasContext).toBe(false);
    expect(result.answer).toContain('Сервис временно недоступен');
  });

  it('refuses with retrieval_failed and shows the infra message when knowledge search throws', async () => {
    const { service, llmProxy } = buildService({
      searchError: new Error('Qdrant down'),
    });

    const result = await service.askQuestion({ question: 'Что такое CRM?' });

    expect(llmProxy.chat).not.toHaveBeenCalled();
    expect(result.refusalReason).toBe('retrieval_failed');
    expect(result.answer).toContain('Сервис временно недоступен');
    expect(result.answer).toContain('Попробуйте задать вопрос ещё раз');
  });

  it('refuses with generation_failed and shows the infra message when LLM proxy throws', async () => {
    const { service } = buildService({
      llmError: new Error('LLM timeout'),
    });

    const result = await service.askQuestion({ question: 'Что такое CRM?' });

    expect(result.refusalReason).toBe('generation_failed');
    expect(result.answer).toContain('Сервис временно недоступен');
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
    const { service, llmProxy } = buildService({
      configOverrides: { CHATBOT_RAG_MAX_CONTEXT_CHARS: 5000 },
      searchResults: [
        buildResultItem({ chunkId: 'top', score: 0.95, chunkIndex: 0, text: bigText }),
        buildResultItem({ chunkId: 'mid', score: 0.85, chunkIndex: 1, text: bigText }),
        buildResultItem({ chunkId: 'low', score: 0.75, chunkIndex: 2, text: bigText }),
      ],
    });

    const result = await service.askQuestion({ question: 'Ok' });

    const chatArg = llmProxy.chat.mock.calls[0][0];
    expect(result.sources).toHaveLength(1);
    expect(result.sources[0].chunkIndex).toBe(0);
    expect(chatArg.messages[1].content.length).toBeLessThan(10_000);
  });

  it('refuses with context_too_large when the char budget cannot fit any chunk', async () => {
    const { service, llmProxy } = buildService({
      // System prompt alone is well over 200 chars; a 200-char budget can't fit a chunk.
      configOverrides: { CHATBOT_RAG_MAX_CONTEXT_CHARS: 200 },
      searchResults: [
        buildResultItem({ chunkId: 'top', score: 0.95, text: 'x'.repeat(1000) }),
      ],
    });

    const result = await service.askQuestion({ question: 'Q' });

    expect(llmProxy.chat).not.toHaveBeenCalled();
    expect(result.refusalReason).toBe('context_too_large');
    expect(result.answer).toContain('Сервис временно недоступен');
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
