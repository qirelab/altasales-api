import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { UserRole } from '../users/entities/user-role.enum';
import { AI_SYSTEM_USER_ID } from './chat.constants';
import { ChatService } from './chat.service';
import { ChatSessionType } from './entities/chat-session-type.enum';
import { ChatParticipantRole } from './entities/chat-participant-role.enum';

function makeUser(
  overrides: Partial<{
    id: string;
    role: UserRole;
    name: string;
    lastName: string;
    email: string;
  }> = {},
) {
  return {
    id: overrides.id ?? 'client-1',
    name: overrides.name ?? 'Client',
    lastName: overrides.lastName ?? 'One',
    email: overrides.email ?? 'client@example.com',
    role: overrides.role ?? UserRole.USER,
  };
}

function buildService(
  opts: {
    existingSession?: unknown;
    existingSessions?: unknown[];
    existingParticipant?: unknown;
    activeExpertIds?: string[];
    saveSessionThrows?: Error;
    transactionThrows?: Error;
    users?: Record<string, unknown>;
    historyMessages?: unknown[];
    conditionalUpdateAffected?: number;
  } = {},
) {
  const users = opts.users ?? { 'client-1': makeUser() };
  const conditionalExecute = jest.fn().mockResolvedValue({
    affected: opts.conditionalUpdateAffected ?? 1,
  });
  const conversationRepository = {
    findOne: jest.fn().mockResolvedValue(opts.existingSession ?? null),
    find: jest.fn().mockResolvedValue(opts.existingSessions ?? []),
    createQueryBuilder: jest.fn(() => ({
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      setParameter: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      execute: conditionalExecute,
    })),
    create: jest.fn((entity) => ({ ...entity, id: 'new-conv' })),
    save: jest.fn(async (entity) => ({ ...entity, id: 'new-conv' })),
    update: jest.fn().mockResolvedValue(undefined),
    conditionalExecute,
  };
  const messageRepository = {
    findOne: jest.fn().mockResolvedValue(null),
    createQueryBuilder: jest.fn(() => ({
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getCount: jest.fn().mockResolvedValue(0),
    })),
    create: jest.fn((entity) => ({ ...entity, id: 'msg-1' })),
    save: jest.fn(async (entity) => ({ ...entity, id: entity.id ?? 'msg-1' })),
  };
  const activeExpertRows = (opts.activeExpertIds ?? []).map((userId) => ({
    userId,
  }));
  const participantRepository = {
    findOne: jest.fn().mockResolvedValue(opts.existingParticipant ?? null),
    find: jest.fn().mockResolvedValue([]),
    delete: jest.fn().mockResolvedValue({ affected: 1 }),
    createQueryBuilder: jest.fn(() => ({
      innerJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue(activeExpertRows),
    })),
    create: jest.fn((entity) => entity),
    save: jest.fn(async (entity) => entity),
  };
  const userRepository = {
    findOne: jest.fn(
      async ({ where }: { where: { id: string } }) => users[where.id] ?? null,
    ),
  };
  const orderRepository = {
    findOne: jest.fn(),
    createQueryBuilder: jest.fn(),
  };
  const wsGateway = { emitToUser: jest.fn() };
  const filesService = {
    findByMessageIds: jest.fn().mockResolvedValue([]),
    linkToMessage: jest.fn().mockResolvedValue(undefined),
    findByIds: jest.fn().mockResolvedValue([]),
  };
  const aiOrchestrator = { scheduleReply: jest.fn() };
  const dataSource = {
    transaction: makeTransaction(),
  };
  function makeTransaction() {
    if (opts.transactionThrows) {
      return jest.fn().mockRejectedValue(opts.transactionThrows);
    }
    return jest.fn(async (fn) => {
      const manager = {
        getRepository: (entity: unknown) => {
          const name =
            (entity as { name?: string })?.name ??
            (entity as { constructor?: { name?: string } })?.constructor?.name;
          if (name === 'ChatSession') return conversationRepository;
          if (name === 'ChatMessage') return messageRepository;
          if (name === 'ChatSessionParticipant') return participantRepository;
          return { create: jest.fn(), save: jest.fn() };
        },
      };
      return fn(manager);
    });
  }

  const sessionTitleService = {
    generateAndAssign: jest.fn().mockResolvedValue(undefined),
  };
  const handoffService = {
    isAiPausedByHandoff: jest.fn(
      (session: { handoffStatus?: string | null }) =>
        session.handoffStatus === 'awaiting' ||
        session.handoffStatus === 'in_progress',
    ),
    autoClaimOnExpertReply: jest.fn().mockResolvedValue(false),
    ensureExpertActiveOnReply: jest.fn().mockResolvedValue('noop'),
  };
  const service = new ChatService(
    conversationRepository as never,
    messageRepository as never,
    participantRepository as never,
    userRepository as never,
    orderRepository as never,
    wsGateway as never,
    filesService as never,
    aiOrchestrator as never,
    sessionTitleService as never,
    handoffService as never,
    dataSource as never,
  );

  return {
    service,
    sessionTitleService,
    conversationRepository,
    messageRepository,
    participantRepository,
    userRepository,
    orderRepository,
    wsGateway,
    aiOrchestrator,
    dataSource,
  };
}

describe('ChatService.openPlatformSession', () => {
  it('rejects a non-USER role with 403', async () => {
    const { service } = buildService({
      users: {
        'expert-1': makeUser({ id: 'expert-1', role: UserRole.EXPERT }),
      },
    });
    await expect(service.openPlatformSession('expert-1')).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('always creates a NEW session even if the client already has one', async () => {
    // Multi-session: openPlatformSession must not reuse an existing session.
    const existing = {
      id: 'existing-conv',
      type: ChatSessionType.Platform,
      title: 'Previous topic',
      orderId: null,
      updatedAt: new Date(),
    };
    const { service, dataSource, conversationRepository } = buildService({
      existingSession: existing,
      users: {
        'client-1': makeUser(),
        [AI_SYSTEM_USER_ID]: makeUser({
          id: AI_SYSTEM_USER_ID,
          name: 'AI-консультант AltaSales',
          role: UserRole.SYSTEM_AI,
        }),
      },
    });
    const result = await service.openPlatformSession('client-1');
    expect(dataSource.transaction).toHaveBeenCalledTimes(1);
    // Result is the freshly-created row, not the existing one.
    expect(result.id).toBe('new-conv');
    expect(conversationRepository.save).toHaveBeenCalled();
  });

  it('registers client + AI participants and seeds NO welcome message on new session', async () => {
    const { service, participantRepository, messageRepository } = buildService({
      users: {
        'client-1': makeUser(),
        [AI_SYSTEM_USER_ID]: makeUser({
          id: AI_SYSTEM_USER_ID,
          role: UserRole.SYSTEM_AI,
          name: 'AI',
        }),
      },
    });
    await service.openPlatformSession('client-1');

    // No message rows are persisted at session creation — the first turn
    // must come from the client and the AI reply is scheduled via
    // sendPlatformMessage / stream endpoint.
    expect(messageRepository.save).not.toHaveBeenCalled();

    const savedParticipants = participantRepository.save.mock.calls
      .flat()
      .flat();
    const roles = savedParticipants.map((p: { role: string }) => p.role);
    expect(roles).toEqual(
      expect.arrayContaining([
        ChatParticipantRole.Client,
        ChatParticipantRole.Ai,
      ]),
    );
  });

  it('auto-joins existing active experts into the newly created session', async () => {
    // A client with an active expert relationship should get that expert
    // added to every new platform session automatically.
    const { service, participantRepository } = buildService({
      activeExpertIds: ['expert-42'],
      users: {
        'client-1': makeUser(),
        [AI_SYSTEM_USER_ID]: makeUser({
          id: AI_SYSTEM_USER_ID,
          role: UserRole.SYSTEM_AI,
          name: 'AI',
        }),
      },
    });
    await service.openPlatformSession('client-1');

    const savedParticipants = participantRepository.save.mock.calls
      .flat()
      .flat();
    const expertRecord = savedParticipants.find(
      (p: { userId: string }) => p.userId === 'expert-42',
    );
    expect(expertRecord).toEqual(
      expect.objectContaining({
        userId: 'expert-42',
        role: ChatParticipantRole.Expert,
      }),
    );
  });

  it('returned session shape includes null title (client has not written yet)', async () => {
    const { service } = buildService({
      users: {
        'client-1': makeUser(),
        [AI_SYSTEM_USER_ID]: makeUser({
          id: AI_SYSTEM_USER_ID,
          role: UserRole.SYSTEM_AI,
          name: 'AI',
        }),
      },
    });
    const result = await service.openPlatformSession('client-1');
    expect(result.title).toBeNull();
  });
});

describe('ChatService.sendMessage — legacy endpoint guardrails', () => {
  it('rejects when recipientId is the AI system user (must use platform endpoint)', async () => {
    const { service } = buildService();
    await expect(
      service.sendMessage('client-1', {
        recipientId: AI_SYSTEM_USER_ID,
        text: 'hi',
      } as never),
    ).rejects.toThrow(BadRequestException);
  });
});

describe('ChatService.sendPlatformMessage', () => {
  function makeSession(overrides: Record<string, unknown> = {}) {
    return {
      id: 'conv-1',
      type: ChatSessionType.Platform,
      title: null,
      participantOneId: AI_SYSTEM_USER_ID,
      participantTwoId: 'client-1',
      orderId: null,
      updatedAt: new Date(),
      ...overrides,
    };
  }

  it('accepts expert-type sessions and schedules AI for the client', async () => {
    const {
      service,
      conversationRepository,
      participantRepository,
      aiOrchestrator,
    } = buildService({
      existingParticipant: {
        userId: 'client-1',
        role: ChatParticipantRole.Client,
      },
    });
    conversationRepository.findOne.mockResolvedValueOnce(
      makeSession({
        type: ChatSessionType.Expert,
        orderId: 'order-1',
        participantOneId: 'client-1',
        participantTwoId: 'expert-1',
      }),
    );
    participantRepository.findOne.mockResolvedValueOnce({
      userId: 'client-1',
      role: ChatParticipantRole.Client,
    });

    await service.sendPlatformMessage('client-1', 'conv-1', {
      text: 'hi',
    } as never);

    expect(aiOrchestrator.scheduleReply).toHaveBeenCalled();
  });

  it('rejects with 403 when user is not a member', async () => {
    const { service, conversationRepository, participantRepository } =
      buildService();
    conversationRepository.findOne.mockResolvedValueOnce(makeSession());
    participantRepository.findOne.mockResolvedValueOnce(null);
    await expect(
      service.sendPlatformMessage('someone-else', 'conv-1', {
        text: 'hi',
      } as never),
    ).rejects.toThrow(ForbiddenException);
  });

  it('client message triggers scheduleReply with the persisted message id', async () => {
    const {
      service,
      conversationRepository,
      participantRepository,
      aiOrchestrator,
      messageRepository,
    } = buildService();
    conversationRepository.findOne.mockResolvedValueOnce(makeSession());
    participantRepository.findOne.mockResolvedValueOnce({
      sessionId: 'conv-1',
      userId: 'client-1',
      role: ChatParticipantRole.Client,
    });
    participantRepository.find.mockResolvedValueOnce([
      { userId: 'client-1', role: ChatParticipantRole.Client },
      { userId: AI_SYSTEM_USER_ID, role: ChatParticipantRole.Ai },
    ]);
    messageRepository.save.mockResolvedValueOnce({
      id: 'client-msg-42',
      sessionId: 'conv-1',
      senderId: 'client-1',
      text: 'q?',
      isAiGenerated: false,
      isRead: false,
      createdAt: new Date(),
    });

    await service.sendPlatformMessage('client-1', 'conv-1', {
      text: 'q?',
    } as never);

    expect(aiOrchestrator.scheduleReply).toHaveBeenCalledTimes(1);
    const arg = aiOrchestrator.scheduleReply.mock.calls[0][0];
    expect(arg.clientMessageId).toBe('client-msg-42');
    expect(arg.clientUserId).toBe('client-1');
    expect(arg.question).toBe('q?');
  });

  it('schedules AI title generation on the client\'s first message when title is null', async () => {
    const {
      service,
      conversationRepository,
      participantRepository,
      sessionTitleService,
    } = buildService();
    conversationRepository.findOne.mockResolvedValueOnce(makeSession());
    participantRepository.findOne.mockResolvedValueOnce({
      sessionId: 'conv-1',
      userId: 'client-1',
      role: ChatParticipantRole.Client,
    });

    await service.sendPlatformMessage('client-1', 'conv-1', {
      text: 'Как настроить отдел продаж?',
    } as never);

    expect(sessionTitleService.generateAndAssign).toHaveBeenCalledWith(
      'conv-1',
      'Как настроить отдел продаж?',
    );
  });

  it('does NOT trigger AI title generation when the session already has a title', async () => {
    const {
      service,
      conversationRepository,
      participantRepository,
      sessionTitleService,
    } = buildService();
    conversationRepository.findOne.mockResolvedValueOnce(
      makeSession({ title: 'Existing topic' }),
    );
    participantRepository.findOne.mockResolvedValueOnce({
      sessionId: 'conv-1',
      userId: 'client-1',
      role: ChatParticipantRole.Client,
    });

    await service.sendPlatformMessage('client-1', 'conv-1', {
      text: 'follow-up question',
    } as never);

    expect(sessionTitleService.generateAndAssign).not.toHaveBeenCalled();
  });

  it('does NOT trigger AI title generation on messages from an expert (only clients seed the title)', async () => {
    const {
      service,
      conversationRepository,
      participantRepository,
      sessionTitleService,
    } = buildService();
    conversationRepository.findOne.mockResolvedValueOnce(makeSession());
    participantRepository.findOne.mockResolvedValueOnce({
      sessionId: 'conv-1',
      userId: 'expert-1',
      role: ChatParticipantRole.Expert,
    });

    await service.sendPlatformMessage('expert-1', 'conv-1', {
      text: 'Let me jump in',
    } as never);

    expect(sessionTitleService.generateAndAssign).not.toHaveBeenCalled();
  });

  it('WS payload uses "session" key with id/updatedAt/title', async () => {
    const {
      service,
      conversationRepository,
      participantRepository,
      wsGateway,
    } = buildService();
    conversationRepository.findOne.mockResolvedValueOnce(
      makeSession({ title: 'Preset' }),
    );
    participantRepository.findOne.mockResolvedValueOnce({
      sessionId: 'conv-1',
      userId: 'client-1',
      role: ChatParticipantRole.Client,
    });

    await service.sendPlatformMessage('client-1', 'conv-1', {
      text: 'msg',
    } as never);

    const newMessageEmits = wsGateway.emitToUser.mock.calls.filter(
      (call) => call[1] === 'chat:new_message',
    );
    expect(newMessageEmits.length).toBeGreaterThan(0);
    const payload = newMessageEmits[0][2] as {
      session?: { id?: string; title?: string | null };
    };
    expect(payload.session).toBeDefined();
    expect(payload.session!.id).toBe('conv-1');
    expect(payload.session!.title).toBe('Preset');
  });

  it('expert message does NOT trigger the AI orchestrator', async () => {
    const {
      service,
      conversationRepository,
      participantRepository,
      aiOrchestrator,
    } = buildService();
    conversationRepository.findOne.mockResolvedValueOnce(makeSession());
    participantRepository.findOne.mockResolvedValueOnce({
      sessionId: 'conv-1',
      userId: 'expert-1',
      role: ChatParticipantRole.Expert,
    });
    await service.sendPlatformMessage('expert-1', 'conv-1', {
      text: 'Let me help',
    } as never);
    expect(aiOrchestrator.scheduleReply).not.toHaveBeenCalled();
  });

  it('resolves a pending handoff when an operator writes into the session', async () => {
    const {
      service,
      conversationRepository,
      participantRepository,
      wsGateway,
    } = buildService({ conditionalUpdateAffected: 1 });
    conversationRepository.findOne.mockResolvedValueOnce(
      makeSession({ needsHumanHandoff: true }),
    );
    participantRepository.findOne.mockResolvedValueOnce({
      sessionId: 'conv-1',
      userId: 'op-1',
      role: ChatParticipantRole.Operator,
    });

    await service.sendPlatformMessage('op-1', 'conv-1', {
      text: 'Hello, I am the manager',
    } as never);

    const resolvedEvents = wsGateway.emitToUser.mock.calls.filter(
      (call) => call[1] === 'chat:handoff_resolved',
    );
    expect(resolvedEvents.length).toBeGreaterThan(0);
    // Payload must carry handoffStatus (client reducer reads it directly)
    // and resolvedBy (matches AdminChatService.resolve shape).
    const payload = resolvedEvents[0][2];
    expect(payload).toMatchObject({
      sessionId: 'conv-1',
      handoffStatus: 'resolved',
    });
    expect(payload).toHaveProperty('resolvedAt');
    expect(payload).toHaveProperty('resolvedBy');
  });

  it('does not reset handoff when a client writes (only human replier resolves)', async () => {
    const {
      service,
      conversationRepository,
      participantRepository,
      wsGateway,
    } = buildService();
    conversationRepository.findOne.mockResolvedValueOnce(
      makeSession({ needsHumanHandoff: true }),
    );
    participantRepository.findOne.mockResolvedValueOnce({
      sessionId: 'conv-1',
      userId: 'client-1',
      role: ChatParticipantRole.Client,
    });

    await service.sendPlatformMessage('client-1', 'conv-1', {
      text: 'follow-up',
    } as never);

    expect(conversationRepository.conditionalExecute).not.toHaveBeenCalled();
    const resolvedEvents = wsGateway.emitToUser.mock.calls.filter(
      (call) => call[1] === 'chat:handoff_resolved',
    );
    expect(resolvedEvents).toHaveLength(0);
  });

  it('does not emit handoff_resolved when the conditional UPDATE affects zero rows', async () => {
    const {
      service,
      conversationRepository,
      participantRepository,
      wsGateway,
    } = buildService({ conditionalUpdateAffected: 0 });
    conversationRepository.findOne.mockResolvedValueOnce(
      makeSession({ needsHumanHandoff: false }),
    );
    participantRepository.findOne.mockResolvedValueOnce({
      sessionId: 'conv-1',
      userId: 'op-1',
      role: ChatParticipantRole.Operator,
    });

    await service.sendPlatformMessage('op-1', 'conv-1', {
      text: 'checking in',
    } as never);

    expect(conversationRepository.conditionalExecute).toHaveBeenCalledTimes(1);
    const resolvedEvents = wsGateway.emitToUser.mock.calls.filter(
      (call) => call[1] === 'chat:handoff_resolved',
    );
    expect(resolvedEvents).toHaveLength(0);
  });
});

describe('ChatService.addExpertToClientPlatformSessions', () => {
  it('creates the initial session and adds the expert when client has no sessions yet', async () => {
    const { service, participantRepository, messageRepository } = buildService({
      existingSessions: [],
      users: {
        'client-1': makeUser(),
        [AI_SYSTEM_USER_ID]: makeUser({
          id: AI_SYSTEM_USER_ID,
          role: UserRole.SYSTEM_AI,
          name: 'AI',
        }),
      },
    });

    await service.addExpertToClientPlatformSessions('client-1', 'expert-99');

    // createPlatformSession no longer seeds a welcome message.
    expect(messageRepository.save).not.toHaveBeenCalled();

    const savedParticipants = participantRepository.save.mock.calls
      .flat()
      .flat();
    const expert = savedParticipants.find(
      (p: { userId?: string }) => p?.userId === 'expert-99',
    );
    expect(expert).toEqual(
      expect.objectContaining({
        userId: 'expert-99',
        role: ChatParticipantRole.Expert,
      }),
    );
  });

  it('adds the expert as participant to every existing platform session', async () => {
    const sessions = [
      { id: 'sess-a', type: ChatSessionType.Platform, orderId: null },
      { id: 'sess-b', type: ChatSessionType.Platform, orderId: null },
    ];
    const { service, participantRepository } = buildService({
      existingSessions: sessions,
    });

    await service.addExpertToClientPlatformSessions('client-1', 'expert-99');

    // ensureParticipant runs one save per session where the expert is absent.
    // participantRepository.findOne resolves null → ensureParticipant persists.
    expect(participantRepository.save).toHaveBeenCalledTimes(2);
    const savedSessionIds = participantRepository.save.mock.calls.map(
      (c) => (c[0] as { sessionId: string }).sessionId,
    );
    expect(savedSessionIds).toEqual(
      expect.arrayContaining(['sess-a', 'sess-b']),
    );
  });
});

describe('ChatService.removeExpertFromClientPlatformSessions', () => {
  it('is a no-op when the client has no platform sessions yet', async () => {
    const { service, participantRepository } = buildService({
      existingSessions: [],
    });

    await service.removeExpertFromClientPlatformSessions(
      'client-1',
      'expert-99',
    );

    expect(participantRepository.delete).not.toHaveBeenCalled();
  });

  it('deletes the expert participant from every existing platform session', async () => {
    const sessions = [
      { id: 'sess-a', type: ChatSessionType.Platform, orderId: null },
      { id: 'sess-b', type: ChatSessionType.Platform, orderId: null },
    ];
    const { service, participantRepository } = buildService({
      existingSessions: sessions,
    });

    await service.removeExpertFromClientPlatformSessions(
      'client-1',
      'expert-99',
    );

    expect(participantRepository.delete).toHaveBeenCalledTimes(2);
    for (const call of participantRepository.delete.mock.calls) {
      expect(call[0]).toEqual(
        expect.objectContaining({
          userId: 'expert-99',
          role: ChatParticipantRole.Expert,
        }),
      );
    }
  });
});

describe('ChatService.ensureExpertServiceSession', () => {
  it('creates an expert session with client, AI and expert participants', async () => {
    const { service, conversationRepository, dataSource } = buildService({
      users: {
        'client-1': makeUser({ id: 'client-1' }),
        'expert-1': makeUser({ id: 'expert-1', role: UserRole.EXPERT }),
      },
    });

    const session = await service.ensureExpertServiceSession(
      'client-1',
      'expert-1',
      'order-1',
      'Аудит воронки',
    );

    expect(session.type).toBe(ChatSessionType.Expert);
    expect(session.orderId).toBe('order-1');
    expect(session.title).toBe('Аудит воронки');
    expect(dataSource.transaction).toHaveBeenCalled();
    expect(conversationRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        type: ChatSessionType.Expert,
        orderId: 'order-1',
      }),
    );
  });

  it('is idempotent when the session already exists', async () => {
    const existing = {
      id: 'existing-expert-sess',
      type: ChatSessionType.Expert,
      orderId: 'order-1',
      title: 'Аудит воронки',
      participantOneId: 'client-1',
      participantTwoId: 'expert-1',
    };
    const { service, dataSource, participantRepository } = buildService({
      existingSession: existing,
    });

    const session = await service.ensureExpertServiceSession(
      'client-1',
      'expert-1',
      'order-1',
      'Аудит воронки',
    );

    expect(session.id).toBe('existing-expert-sess');
    expect(dataSource.transaction).not.toHaveBeenCalled();
    expect(participantRepository.save).toHaveBeenCalled();
  });

  it('skips AI reply when expert order is completed', async () => {
    const { service, aiOrchestrator, orderRepository, participantRepository } =
      buildService({
        existingSession: {
          id: 'expert-sess',
          type: ChatSessionType.Expert,
          orderId: 'order-1',
          title: 'Аудит',
          handoffStatus: null,
        },
        existingParticipant: {
          userId: 'client-1',
          role: ChatParticipantRole.Client,
        },
        users: { 'client-1': makeUser() },
      });
    orderRepository.findOne.mockResolvedValue({
      id: 'order-1',
      status: 'completed',
    });

    await service.sendPlatformMessage('client-1', 'expert-sess', {
      text: 'Вопрос по аудиту',
    });

    expect(aiOrchestrator.scheduleReply).not.toHaveBeenCalled();
    expect(participantRepository.findOne).toHaveBeenCalled();
  });

  it('ensureExpertSessionsForUser creates sessions for prior paid purchases', async () => {
    const order = {
      id: 'legacy-order',
      userId: 'client-1',
      status: 'planned',
      item: {
        executorUserId: 'expert-1',
        service: { name: 'Аудит воронки', description: 'desc' },
      },
    };
    const { service, orderRepository, dataSource } = buildService({
      users: {
        'client-1': makeUser({ id: 'client-1' }),
        'expert-1': makeUser({ id: 'expert-1', role: UserRole.EXPERT }),
      },
    });
    const qb = {
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getMany: jest.fn(),
    };
    // First call = asClient, second = asExpert
    qb.getMany.mockResolvedValueOnce([order]).mockResolvedValueOnce([]);
    orderRepository.createQueryBuilder = jest.fn(() => qb);

    await service.ensureExpertSessionsForUser('client-1');

    expect(dataSource.transaction).toHaveBeenCalled();
  });
});
