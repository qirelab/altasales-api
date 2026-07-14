import { AI_SYSTEM_USER_ID } from '../chat.constants';
import { AiChatOrchestratorService } from './ai-chat-orchestrator.service';
import { ChatHistoryMapperService } from './chat-history-mapper.service';

function makeMessage(overrides: Record<string, unknown> = {}) {
  return {
    id: overrides.id ?? 'msg-generated',
    conversationId: 'conv-1',
    senderId: overrides.senderId ?? 'client-1',
    text: overrides.text ?? 'txt',
    isRead: false,
    isAiGenerated: overrides.isAiGenerated ?? false,
    createdAt: overrides.createdAt ?? new Date(),
  };
}

describe('AiChatOrchestratorService', () => {
  function buildOrchestrator(opts: {
    historyRows?: ReturnType<typeof makeMessage>[];
    ragAnswer?: string;
    ragRefusalReason?: string;
    ragThrows?: Error;
  } = {}) {
    const messageRepository = {
      // Real repository respects `order: { createdAt: 'DESC' }`. Return rows
      // newest-first so orchestrator's `.reverse()` gives back chronological.
      find: jest.fn().mockImplementation((options?: {
        order?: { createdAt?: 'ASC' | 'DESC' };
      }) => {
        const rows = opts.historyRows ?? [];
        if (options?.order?.createdAt === 'DESC') {
          return Promise.resolve([...rows].reverse());
        }
        return Promise.resolve(rows);
      }),
      create: jest.fn((entity) => ({ ...entity, id: 'ai-msg-1' })),
      save: jest.fn(async (entity) => ({ ...entity, id: 'ai-msg-1' })),
    };
    const conversationRepository = {
      update: jest.fn().mockResolvedValue(undefined),
    };
    const ragService = {
      askQuestion: opts.ragThrows
        ? jest.fn().mockRejectedValue(opts.ragThrows)
        : jest.fn().mockResolvedValue({
          answer: opts.ragAnswer ?? 'AI answer',
          hasContext: true,
          sources: [],
          refusalReason: opts.ragRefusalReason,
        }),
    };
    const wsGateway = {
      emitToUser: jest.fn(),
    };
    const historyMapper = new ChatHistoryMapperService();
    const orchestrator = new AiChatOrchestratorService(
      messageRepository as never,
      conversationRepository as never,
      ragService as never,
      historyMapper,
      wsGateway as never,
    );
    return {
      orchestrator,
      messageRepository,
      conversationRepository,
      ragService,
      wsGateway,
    };
  }

  const conversation = { id: 'conv-1' } as never;
  const clientUserId = 'client-1';

  it('generates AI reply, persists as isAiGenerated message from AI_SYSTEM_USER_ID, and emits WS', async () => {
    const { orchestrator, messageRepository, conversationRepository, ragService, wsGateway } =
      buildOrchestrator({
        historyRows: [
          makeMessage({ id: 'm1', senderId: clientUserId, text: 'first' }),
          makeMessage({ id: 'm2', senderId: 'ai', isAiGenerated: true, text: 'a1' }),
          makeMessage({ id: 'm3', senderId: clientUserId, text: 'question now' }),
        ],
        ragAnswer: 'Here is your answer',
      });

    await (orchestrator as unknown as {
      respondToClientMessage: (input: unknown) => Promise<void>;
    }).respondToClientMessage({
      conversation,
      clientUserId,
      clientMessageId: 'm3',
      question: 'question now',
      recipientIds: ['client-1', 'expert-1'],
    });

    // History passed to RAG must exclude the current (last) message.
    const ragCall = ragService.askQuestion.mock.calls[0][0];
    expect(ragCall.question).toBe('question now');
    expect(ragCall.history).toEqual([
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'a1' },
    ]);

    // Persisted AI message.
    expect(messageRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 'conv-1',
        senderId: AI_SYSTEM_USER_ID,
        text: 'Here is your answer',
        isAiGenerated: true,
      }),
    );
    expect(messageRepository.save).toHaveBeenCalledTimes(1);

    // Conversation touched.
    expect(conversationRepository.update).toHaveBeenCalledWith(
      'conv-1',
      expect.objectContaining({ updatedAt: expect.any(Date) }),
    );

    // WS emitted to every recipient.
    expect(wsGateway.emitToUser).toHaveBeenCalledTimes(2);
    expect(wsGateway.emitToUser).toHaveBeenCalledWith(
      'client-1',
      'chat:new_message',
      expect.objectContaining({
        message: expect.objectContaining({
          senderId: AI_SYSTEM_USER_ID,
          isAiGenerated: true,
        }),
      }),
    );
    expect(wsGateway.emitToUser).toHaveBeenCalledWith(
      'expert-1',
      'chat:new_message',
      expect.any(Object),
    );
  });

  it('handles empty history (fresh conversation) — only the current question is passed', async () => {
    const { orchestrator, ragService } = buildOrchestrator({
      historyRows: [
        // Only the just-arrived message from the client is in the DB.
        makeMessage({ id: 'm1', senderId: clientUserId, text: 'first ever' }),
      ],
    });

    await (orchestrator as unknown as {
      respondToClientMessage: (input: unknown) => Promise<void>;
    }).respondToClientMessage({
      conversation,
      clientUserId,
      clientMessageId: 'm1',
      question: 'first ever',
      recipientIds: ['client-1'],
    });

    const ragCall = ragService.askQuestion.mock.calls[0][0];
    expect(ragCall.history).toEqual([]);
  });

  it('filters history by clientMessageId — a fast-typing double message does not leak into RAG', async () => {
    // Client sent m3, we scheduled the reply, but before we ran the client
    // already sent m4. History load picks up both m3 (the one we own) and
    // m4 (queued after us). Only m3 must be dropped — m4 stays as a client
    // message the LLM did not ask for but is legit context now.
    const { orchestrator, ragService } = buildOrchestrator({
      historyRows: [
        makeMessage({ id: 'm1', senderId: clientUserId, text: 'first' }),
        makeMessage({ id: 'm2', senderId: 'ai', isAiGenerated: true, text: 'a1' }),
        makeMessage({ id: 'm3', senderId: clientUserId, text: 'question now' }),
        makeMessage({ id: 'm4', senderId: clientUserId, text: 'oops one more' }),
      ],
    });

    await (orchestrator as unknown as {
      respondToClientMessage: (input: unknown) => Promise<void>;
    }).respondToClientMessage({
      conversation,
      clientUserId,
      clientMessageId: 'm3',
      question: 'question now',
      recipientIds: ['client-1'],
    });

    const ragCall = ragService.askQuestion.mock.calls[0][0];
    expect(ragCall.history).toEqual([
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'a1' },
      { role: 'user', content: 'oops one more' },
    ]);
  });

  it('scheduleReply swallows any error from the async task (never throws to caller)', async () => {
    const { orchestrator } = buildOrchestrator({
      ragThrows: new Error('LLM down'),
    });
    expect(() =>
      orchestrator.scheduleReply({
        conversation,
        clientUserId,
        clientMessageId: 'm1',
        question: 'q',
        recipientIds: ['client-1'],
      }),
    ).not.toThrow();
    // Give the microtask a chance to reject and be caught.
    await new Promise((resolve) => setImmediate(resolve));
  });
});
