import { AI_SYSTEM_USER_ID } from '../chat.constants';
import { ChatConversationType } from '../entities/chat-conversation-type.enum';
import {
  AiChatOrchestratorService,
  StreamReplyHooks,
} from './ai-chat-orchestrator.service';
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

function buildOrchestrator(
  opts: {
    currentMessage?: ReturnType<typeof makeMessage> | null;
    ragEvents?: unknown[];
    ragThrows?: Error;
    participants?: { userId: string }[];
  } = {},
) {
  const qb = {
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    addOrderBy: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    getMany: jest.fn().mockResolvedValue([]),
  };
  const messageRepository = {
    findOne: jest
      .fn()
      .mockResolvedValue(
        opts.currentMessage === null
          ? null
          : (opts.currentMessage ?? makeMessage({ id: 'client-msg-1' })),
      ),
    createQueryBuilder: jest.fn().mockReturnValue(qb),
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
          { userId: 'expert-1' },
          { userId: AI_SYSTEM_USER_ID },
        ],
      ),
  };
  const defaultRagEvents = [
    { type: 'delta', content: 'Пр' },
    { type: 'delta', content: 'ивет' },
    {
      type: 'done',
      response: { answer: 'Привет', hasContext: true, sources: [] },
    },
  ];
  const askQuestionStream = opts.ragThrows
    ? makeThrowingRagStream(opts.ragThrows)
    : makeYieldingRagStream(opts.ragEvents ?? defaultRagEvents);
  const ragService = {
    askQuestion: jest.fn(),
    askQuestionStream,
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
    wsGateway,
  };
}

function makeThrowingRagStream(error: Error) {
  return jest.fn(() => {
    throw error;
  });
}

function makeYieldingRagStream(events: unknown[]) {
  return jest.fn(() =>
    (async function* () {
      for (const event of events) yield event;
    })(),
  );
}

const conversation = {
  id: 'conv-1',
  type: ChatConversationType.Platform,
  participantOneId: 'client-1',
  participantTwoId: AI_SYSTEM_USER_ID,
} as never;

type HookCalls = {
  deltas: string[];
  done: string[];
  refusal: string[];
  error: string[];
};

describe('AiChatOrchestratorService.streamReply', () => {
  function makeHooks(): { hooks: StreamReplyHooks; calls: HookCalls } {
    const calls = {
      deltas: [] as string[],
      done: [] as string[],
      refusal: [] as string[],
      error: [] as string[],
    };
    return {
      calls,
      hooks: {
        onDelta: (content) => calls.deltas.push(content),
        onDone: (message) => calls.done.push(message.id),
        onRefusal: (message, reason) =>
          calls.refusal.push(`${message.id}:${reason}`),
        onError: (reason) => calls.error.push(reason),
      },
    };
  }

  it('forwards deltas to onDelta and persists the accumulated answer as an AI message', async () => {
    const { orchestrator, messageRepository, wsGateway } = buildOrchestrator();
    const { hooks, calls } = makeHooks();

    await orchestrator.streamReply(
      {
        conversation,
        clientUserId: 'client-1',
        clientMessageId: 'client-msg-1',
        question: 'Привет?',
      },
      hooks,
    );

    expect(calls.deltas).toEqual(['Пр', 'ивет']);
    expect(calls.done).toEqual(['ai-msg-1']);
    expect(calls.refusal).toHaveLength(0);
    expect(calls.error).toHaveLength(0);
    // The AI message must be persisted with the accumulated text.
    expect(messageRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        text: 'Привет',
        senderId: AI_SYSTEM_USER_ID,
        isAiGenerated: true,
      }),
    );
    // WS is emitted to OTHER participants, never to the streaming client
    // (they already saw the deltas over SSE).
    const targetIds = wsGateway.emitToUser.mock.calls.map((call) => call[0]);
    expect(targetIds).toContain('expert-1');
    expect(targetIds).not.toContain('client-1');
    expect(targetIds).not.toContain(AI_SYSTEM_USER_ID);
  });

  it('routes RAG refusal to onRefusal with the refusal reason', async () => {
    const { orchestrator } = buildOrchestrator({
      ragEvents: [
        {
          type: 'refusal',
          response: {
            answer: 'Я не нашёл информации по этому вопросу.',
            hasContext: false,
            sources: [],
            refusalReason: 'no_results',
          },
        },
      ],
    });
    const { hooks, calls } = makeHooks();

    await orchestrator.streamReply(
      {
        conversation,
        clientUserId: 'client-1',
        clientMessageId: 'client-msg-1',
        question: 'unknown',
      },
      hooks,
    );

    expect(calls.deltas).toHaveLength(0);
    expect(calls.refusal).toEqual(['ai-msg-1:no_results']);
    expect(calls.done).toHaveLength(0);
  });

  it('emits onError when the client message is missing', async () => {
    const { orchestrator, messageRepository } = buildOrchestrator({
      currentMessage: null,
    });
    const { hooks, calls } = makeHooks();

    await orchestrator.streamReply(
      {
        conversation,
        clientUserId: 'client-1',
        clientMessageId: 'ghost-message',
        question: 'anything',
      },
      hooks,
    );

    expect(calls.error).toEqual(['client_message_missing']);
    expect(messageRepository.save).not.toHaveBeenCalled();
  });

  it('forwards the AbortSignal down to askQuestionStream and bails before persisting on abort', async () => {
    const askQuestionStream = jest.fn((_input, _signal) =>
      (async function* () {
        yield {
          type: 'refusal',
          response: {
            answer: 'Сервис временно недоступен.',
            hasContext: false,
            sources: [],
            refusalReason: 'generation_failed',
          },
        };
      })(),
    );
    const { orchestrator, messageRepository } = buildOrchestrator({
      participants: [{ userId: 'client-1' }, { userId: 'expert-1' }],
    });
    // Swap the default rag mock for one that captures the signal and returns
    // a refusal (mirroring what RAG does on AbortError).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (orchestrator as any).ragService = { askQuestionStream };
    const { hooks, calls } = makeHooks();
    const controller = new AbortController();
    controller.abort();

    await orchestrator.streamReply(
      {
        conversation,
        clientUserId: 'client-1',
        clientMessageId: 'client-msg-1',
        question: 'anything',
      },
      hooks,
      controller.signal,
    );

    expect(askQuestionStream).toHaveBeenCalledWith(
      expect.any(Object),
      controller.signal,
    );
    // On abort we surface client_disconnected and NEVER persist a synthetic
    // "service unavailable" AI message — the QA'd regression.
    expect(calls.error).toEqual(['client_disconnected']);
    expect(messageRepository.save).not.toHaveBeenCalled();
  });

  it('emits onError when the RAG stream throws mid-flight', async () => {
    const { orchestrator } = buildOrchestrator({
      ragThrows: new Error('boom'),
    });
    const { hooks, calls } = makeHooks();

    await orchestrator.streamReply(
      {
        conversation,
        clientUserId: 'client-1',
        clientMessageId: 'client-msg-1',
        question: 'anything',
      },
      hooks,
    );

    expect(calls.error).toEqual(['stream_failed']);
  });
});
