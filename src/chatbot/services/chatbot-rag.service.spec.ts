import { AgentId } from '../../ai/enums/agent-id.enum';
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
  llmContent?: string;
} = {}) {
  const knowledgeSearch = {
    search: jest.fn().mockResolvedValue({
      results: overrides.searchResults ?? [buildResultItem()],
    }),
  };
  const llmProxy = {
    chat: jest.fn().mockResolvedValue({
      providerId: 'mock',
      modelId: 'mock',
      content: overrides.llmContent ?? 'Готовый ответ от бота.',
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      dataClass: 'raw_pii',
    }),
  };
  const service = new ChatbotRagService(
    knowledgeSearch as never,
    llmProxy as never,
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
    expect(chatArg.messages[0].role).toBe('system');
    expect(chatArg.messages[1].role).toBe('user');
    expect(chatArg.messages[1].content).toContain('Пакет CRM Silver стоит 100 000 ₽.');
    expect(chatArg.messages[1].content).toContain('Сколько стоит CRM Silver?');
    expect(chatArg.policy?.cacheTtlMs).toBeGreaterThan(0);

    expect(result.hasContext).toBe(true);
    expect(result.answer).toBe('Готовый ответ от бота.');
    expect(result.sources).toHaveLength(2);
    expect(result.sources[0]).toEqual({
      documentId: 'doc-1',
      documentTitle: 'Guide',
      chunkIndex: 0,
      score: 0.9,
    });
  });

  it('refuses when knowledge search returns nothing without calling LLM', async () => {
    const { service, llmProxy } = buildService({ searchResults: [] });

    const result = await service.askQuestion({ question: 'Странный вопрос' });

    expect(llmProxy.chat).not.toHaveBeenCalled();
    expect(result.hasContext).toBe(false);
    expect(result.sources).toEqual([]);
    expect(result.answer).toContain('Я не нашёл информации');
  });

  it('refuses when all results are below the relevance threshold without calling LLM', async () => {
    const { service, llmProxy } = buildService({
      searchResults: [
        buildResultItem({ score: 0.2 }),
        buildResultItem({ score: 0.1 }),
      ],
    });

    const result = await service.askQuestion({ question: 'Что-то нерелевантное' });

    expect(llmProxy.chat).not.toHaveBeenCalled();
    expect(result.hasContext).toBe(false);
  });

  it('refuses on empty question and skips retrieval', async () => {
    const { service, knowledgeSearch, llmProxy } = buildService();

    const result = await service.askQuestion({ question: '   ' });

    expect(knowledgeSearch.search).not.toHaveBeenCalled();
    expect(llmProxy.chat).not.toHaveBeenCalled();
    expect(result.hasContext).toBe(false);
    expect(result.answer).toContain('Я не нашёл информации');
  });

  it('falls back to the refusal message when the LLM returns an empty answer', async () => {
    const { service } = buildService({ llmContent: '   ' });

    const result = await service.askQuestion({ question: 'Что такое CRM?' });

    expect(result.hasContext).toBe(false);
    expect(result.answer).toContain('Я не нашёл информации');
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
});
