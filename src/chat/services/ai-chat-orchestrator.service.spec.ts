import { AI_SYSTEM_USER_ID } from '../chat.constants';
import { ChatConversationType } from '../entities/chat-conversation-type.enum';
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
  function buildOrchestrator(
    opts: {
      historyRows?: ReturnType<typeof makeMessage>[];
      currentMessage?: ReturnType<typeof makeMessage> | null;
      ragAnswer?: string;
      ragRefusalReason?: string;
      ragThrows?: Error;
      participants?: { userId: string }[];
    } = {},
  ) {
    // Default: currentMessage.createdAt = now, all history rows keep their
    // (default now) timestamps so nothing is filtered out by createdAt.
    // QueryBuilder mock that captures the where clauses the orchestrator
    // sets and applies them against `historyRows` on `getMany()`. Only the
    // clauses actually used by the code (createdAt cutoff + id exclude) are
    // interpreted; unknown clauses are recorded but do not filter.
    const qbState: { cutoff?: Date } = {};
    const qb: {
      where: jest.Mock;
      andWhere: jest.Mock;
      orderBy: jest.Mock;
      addOrderBy: jest.Mock;
      take: jest.Mock;
      getMany: jest.Mock;
    } = {
      where: jest.fn().mockImplementation(() => qb),
      andWhere: jest
        .fn()
        .mockImplementation((sql: string, params?: Record<string, unknown>) => {
          if (
            sql.includes('createdAt') &&
            sql.includes('<') &&
            params?.cutoff instanceof Date
          ) {
            qbState.cutoff = params.cutoff;
          }
          return qb;
        }),
      orderBy: jest.fn().mockImplementation(() => qb),
      addOrderBy: jest.fn().mockImplementation(() => qb),
      take: jest.fn().mockImplementation(() => qb),
      getMany: jest.fn().mockImplementation(() => {
        const rows = opts.historyRows ?? [];
        const filtered = rows.filter((m) => {
          // Strict `<` — same-tick messages (including the current turn
          // itself and any fast-typing sibling) are excluded.
          if (qbState.cutoff && (m.createdAt as Date) >= qbState.cutoff)
            return false;
          return true;
        });
        // Emulate ORDER BY createdAt DESC + take(HISTORY_FETCH_LIMIT).
        return Promise.resolve([...filtered].reverse());
      }),
    };

    const messageRepository = {
      findOne: jest
        .fn()
        .mockImplementation((options?: { where?: { id?: string } }) => {
          if (options?.where?.id && opts.currentMessage !== null) {
            return Promise.resolve(
              opts.currentMessage ??
                (opts.historyRows ?? []).find(
                  (m) => m.id === options.where?.id,
                ) ??
                null,
            );
          }
          return Promise.resolve(null);
        }),
      createQueryBuilder: jest.fn().mockImplementation(() => qb),
      create: jest.fn((entity) => ({ ...entity, id: 'ai-msg-1' })),
      save: jest.fn(async (entity) => ({ ...entity, id: 'ai-msg-1' })),
    };
    const conversationRepository = {
      update: jest.fn().mockResolvedValue(undefined),
    };
    const participantRepository = {
      find: jest
        .fn()
        .mockResolvedValue(
          opts.participants ?? [
            { userId: 'client-1' },
            { userId: AI_SYSTEM_USER_ID },
          ],
        ),
    };
    const ragResolution = {
      answer: opts.ragAnswer ?? 'AI answer',
      hasContext: true,
      sources: [],
      refusalReason: opts.ragRefusalReason,
    };
    const ragService = {
      askQuestion: opts.ragThrows
        ? jest.fn().mockRejectedValue(opts.ragThrows)
        : jest.fn().mockResolvedValue(ragResolution),
    };
    const wsGateway = {
      emitToUser: jest.fn(),
    };
    const historyMapper = new ChatHistoryMapperService();
    const orchestrator = new AiChatOrchestratorService(
      messageRepository as never,
      conversationRepository as never,
      participantRepository as never,
      ragService as never,
      historyMapper,
      wsGateway as never,
    );
    return {
      orchestrator,
      messageRepository,
      conversationRepository,
      participantRepository,
      ragService,
      wsGateway,
    };
  }

  const conversation = {
    id: 'conv-1',
    type: ChatConversationType.Platform,
  } as never;
  const clientUserId = 'client-1';

  it('generates AI reply, persists as isAiGenerated message from AI_SYSTEM_USER_ID, and emits WS', async () => {
    const t0 = new Date('2026-01-01T10:00:00.000Z');
    const t1 = new Date('2026-01-01T10:00:01.000Z');
    const t2 = new Date('2026-01-01T10:00:02.000Z');
    const m3 = makeMessage({
      id: 'm3',
      senderId: clientUserId,
      text: 'question now',
      createdAt: t2,
    });
    const {
      orchestrator,
      messageRepository,
      conversationRepository,
      ragService,
      wsGateway,
    } = buildOrchestrator({
      historyRows: [
        makeMessage({
          id: 'm1',
          senderId: clientUserId,
          text: 'first',
          createdAt: t0,
        }),
        makeMessage({
          id: 'm2',
          senderId: 'ai',
          isAiGenerated: true,
          text: 'a1',
          createdAt: t1,
        }),
        m3,
      ],
      currentMessage: m3,
      ragAnswer: 'Here is your answer',
      participants: [
        { userId: 'client-1' },
        { userId: 'expert-1' },
        { userId: AI_SYSTEM_USER_ID },
      ],
    });

    await (
      orchestrator as unknown as {
        respondToClientMessage: (input: unknown) => Promise<void>;
      }
    ).respondToClientMessage({
      conversation,
      clientUserId,
      clientMessageId: 'm3',
      question: 'question now',
    });

    const ragCall = ragService.askQuestion.mock.calls[0][0];
    expect(ragCall.question).toBe('question now');
    expect(ragCall.history).toEqual([
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'a1' },
    ]);

    expect(messageRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 'conv-1',
        senderId: AI_SYSTEM_USER_ID,
        text: 'Here is your answer',
        isAiGenerated: true,
      }),
    );
    expect(messageRepository.save).toHaveBeenCalledTimes(1);
    expect(conversationRepository.update).toHaveBeenCalledWith(
      'conv-1',
      expect.objectContaining({ updatedAt: expect.any(Date) }),
    );

    // WS emitted to every current participant except the AI user.
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
    expect(wsGateway.emitToUser).not.toHaveBeenCalledWith(
      AI_SYSTEM_USER_ID,
      expect.any(String),
      expect.any(Object),
    );
  });

  it('handles empty history (fresh conversation) — only the current question is passed', async () => {
    const m1 = makeMessage({
      id: 'm1',
      senderId: clientUserId,
      text: 'first ever',
    });
    const { orchestrator, ragService } = buildOrchestrator({
      historyRows: [m1],
      currentMessage: m1,
    });

    await (
      orchestrator as unknown as {
        respondToClientMessage: (input: unknown) => Promise<void>;
      }
    ).respondToClientMessage({
      conversation,
      clientUserId,
      clientMessageId: 'm1',
      question: 'first ever',
    });

    const ragCall = ragService.askQuestion.mock.calls[0][0];
    expect(ragCall.history).toEqual([]);
  });

  it('excludes future fast-typing messages from history (RAG only sees the past)', async () => {
    // Client sent m3, then m4 before m3's task ran. m3's task must load ONLY
    // messages with createdAt <= m3.createdAt and additionally drop m3 itself
    // (already in `question`) and same-tick m4. m4 must NOT reach RAG.
    const t0 = new Date('2026-01-01T10:00:00.000Z');
    const t1 = new Date('2026-01-01T10:00:01.000Z');
    const t2 = new Date('2026-01-01T10:00:02.000Z');
    const t3 = new Date('2026-01-01T10:00:03.000Z');
    const m3 = makeMessage({
      id: 'm3',
      senderId: clientUserId,
      text: 'question now',
      createdAt: t2,
    });
    const m4Future = makeMessage({
      id: 'm4',
      senderId: clientUserId,
      text: 'oops one more',
      createdAt: t3,
    });
    const { orchestrator, ragService } = buildOrchestrator({
      historyRows: [
        makeMessage({
          id: 'm1',
          senderId: clientUserId,
          text: 'first',
          createdAt: t0,
        }),
        makeMessage({
          id: 'm2',
          senderId: 'ai',
          isAiGenerated: true,
          text: 'a1',
          createdAt: t1,
        }),
        m3,
        m4Future,
      ],
      currentMessage: m3,
    });

    await (
      orchestrator as unknown as {
        respondToClientMessage: (input: unknown) => Promise<void>;
      }
    ).respondToClientMessage({
      conversation,
      clientUserId,
      clientMessageId: 'm3',
      question: 'question now',
    });

    const ragCall = ragService.askQuestion.mock.calls[0][0];
    expect(ragCall.history).toEqual([
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'a1' },
    ]);
  });

  it('excludes a same-tick sibling from history (strict createdAt <)', async () => {
    // Fast-typing race: m3 and m4 land on the SAME timestamp tick. Neither
    // should see the other in its history. Strict `createdAt <` cutoff
    // guarantees that: for m3's task, m4 (same tick) fails the `< cutoff`
    // check and is dropped even though m4 has a different id.
    const sameTick = new Date('2026-01-01T10:00:02.000Z');
    const before = new Date('2026-01-01T10:00:01.000Z');
    const m1 = makeMessage({
      id: 'm1',
      senderId: clientUserId,
      text: 'earlier',
      createdAt: before,
    });
    const m3 = makeMessage({
      id: 'm3',
      senderId: clientUserId,
      text: 'q now',
      createdAt: sameTick,
    });
    const m4Same = makeMessage({
      id: 'm4',
      senderId: clientUserId,
      text: 'q sibling',
      createdAt: sameTick,
    });
    const { orchestrator, ragService } = buildOrchestrator({
      historyRows: [m1, m3, m4Same],
      currentMessage: m3,
    });

    await (
      orchestrator as unknown as {
        respondToClientMessage: (input: unknown) => Promise<void>;
      }
    ).respondToClientMessage({
      conversation,
      clientUserId,
      clientMessageId: 'm3',
      question: 'q now',
    });

    const ragCall = ragService.askQuestion.mock.calls[0][0];
    // Only strictly-past m1 remains. m3 (self) and m4 (same tick) are dropped.
    expect(ragCall.history).toEqual([{ role: 'user', content: 'earlier' }]);
  });

  it('skips silently when the client message no longer exists', async () => {
    const { orchestrator, ragService } = buildOrchestrator({
      historyRows: [],
      currentMessage: null,
    });

    await (
      orchestrator as unknown as {
        respondToClientMessage: (input: unknown) => Promise<void>;
      }
    ).respondToClientMessage({
      conversation,
      clientUserId,
      clientMessageId: 'deleted',
      question: 'q',
    });

    expect(ragService.askQuestion).not.toHaveBeenCalled();
  });

  it('serializes reply tasks per-conversation so m3 finishes before m4', async () => {
    const t1 = new Date('2026-01-01T10:00:01.000Z');
    const t2 = new Date('2026-01-01T10:00:02.000Z');
    const m3 = makeMessage({
      id: 'm3',
      senderId: clientUserId,
      text: 'q1',
      createdAt: t1,
    });
    const m4 = makeMessage({
      id: 'm4',
      senderId: clientUserId,
      text: 'q2',
      createdAt: t2,
    });
    const started: string[] = [];
    const finished: string[] = [];
    const { orchestrator, messageRepository, ragService } = buildOrchestrator({
      historyRows: [m3, m4],
    });
    messageRepository.findOne.mockImplementation(
      async (opts: { where?: { id?: string } }) => {
        const id = opts.where?.id;
        started.push(id ?? 'unknown');
        return id === 'm3' ? m3 : id === 'm4' ? m4 : null;
      },
    );
    ragService.askQuestion.mockImplementation(async (input) => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      finished.push(input.question);
      return { answer: 'ok', hasContext: true, sources: [] };
    });

    orchestrator.scheduleReply({
      conversation,
      clientUserId,
      clientMessageId: 'm3',
      question: 'q1',
    });
    orchestrator.scheduleReply({
      conversation,
      clientUserId,
      clientMessageId: 'm4',
      question: 'q2',
    });
    await new Promise((resolve) => setTimeout(resolve, 50));

    // m3's task must finish before m4's task even starts loading its message.
    expect(finished).toEqual(['q1', 'q2']);
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
      }),
    ).not.toThrow();
    await new Promise((resolve) => setImmediate(resolve));
  });
});
