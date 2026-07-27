import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import { UserRole } from '../users/entities/user-role.enum';
import { AI_SYSTEM_USER_ID, AI_WELCOME_MESSAGE } from './chat.constants';
import { ChatService } from './chat.service';
import { ChatConversationType } from './entities/chat-conversation-type.enum';
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
    existingConversation?: unknown;
    existingParticipant?: unknown;
    saveConversationThrows?: Error;
    transactionThrows?: Error;
    users?: Record<string, unknown>;
    historyMessages?: unknown[];
  } = {},
) {
  const users = opts.users ?? { 'client-1': makeUser() };
  const conversationRepository = {
    findOne: jest.fn().mockResolvedValue(opts.existingConversation ?? null),
    createQueryBuilder: jest.fn(() => ({
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      setParameter: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
    })),
    create: jest.fn((entity) => ({ ...entity, id: 'new-conv' })),
    save: jest.fn(async (entity) => ({ ...entity, id: 'new-conv' })),
    update: jest.fn().mockResolvedValue(undefined),
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
  const participantRepository = {
    findOne: jest.fn().mockResolvedValue(opts.existingParticipant ?? null),
    find: jest.fn().mockResolvedValue([]),
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
    transaction: opts.transactionThrows
      ? jest.fn().mockRejectedValue(opts.transactionThrows)
      : jest.fn(async (fn) => {
          const manager = {
            getRepository: (entity: unknown) => {
              const name =
                (entity as { name?: string })?.name ??
                (entity as { constructor?: { name?: string } })?.constructor
                  ?.name;
              if (name === 'ChatConversation') return conversationRepository;
              if (name === 'ChatMessage') return messageRepository;
              if (name === 'ChatConversationParticipant')
                return participantRepository;
              return { create: jest.fn(), save: jest.fn() };
            },
          };
          return fn(manager);
        }),
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
    dataSource as never,
  );

  return {
    service,
    conversationRepository,
    messageRepository,
    participantRepository,
    userRepository,
    wsGateway,
    aiOrchestrator,
    dataSource,
  };
}

describe('ChatService.openPlatformConversation', () => {
  it('rejects a non-USER role with 403', async () => {
    const { service } = buildService({
      users: {
        'expert-1': makeUser({ id: 'expert-1', role: UserRole.EXPERT }),
      },
    });
    await expect(service.openPlatformConversation('expert-1')).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('returns existing conversation without touching the DB writer path', async () => {
    const existing = {
      id: 'existing-conv',
      type: ChatConversationType.Platform,
      orderId: null,
      updatedAt: new Date(),
    };
    const { service, dataSource } = buildService({
      existingConversation: existing,
      users: {
        'client-1': makeUser(),
        [AI_SYSTEM_USER_ID]: makeUser({
          id: AI_SYSTEM_USER_ID,
          name: 'AI-консультант AltaSales',
          role: UserRole.SYSTEM_AI,
        }),
      },
    });
    const result = await service.openPlatformConversation('client-1');
    expect(result.id).toBe('existing-conv');
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  it('re-reads the conversation on unique-constraint race (23505)', async () => {
    const raced = {
      id: 'raced-conv',
      type: ChatConversationType.Platform,
      orderId: null,
      updatedAt: new Date(),
    };
    // findOne is called twice: first pre-check (null → try transaction), and
    // then after 23505 catch (returns the concurrent writer's row).
    const conversationFindOne = jest
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(raced);
    const uniqueViolation = new QueryFailedError('', [], new Error('dup'));
    (uniqueViolation as unknown as { code: string }).code = '23505';
    const { service, conversationRepository } = buildService({
      transactionThrows: uniqueViolation,
      users: {
        'client-1': makeUser(),
        [AI_SYSTEM_USER_ID]: makeUser({
          id: AI_SYSTEM_USER_ID,
          role: UserRole.SYSTEM_AI,
          name: 'AI',
        }),
      },
    });
    conversationRepository.findOne = conversationFindOne;

    const result = await service.openPlatformConversation('client-1');
    expect(result.id).toBe('raced-conv');
    expect(conversationFindOne).toHaveBeenCalledTimes(2);
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
  function makeConversation(overrides: Record<string, unknown> = {}) {
    return {
      id: 'conv-1',
      type: ChatConversationType.Platform,
      participantOneId: AI_SYSTEM_USER_ID,
      participantTwoId: 'client-1',
      orderId: null,
      updatedAt: new Date(),
      ...overrides,
    };
  }

  it('rejects with 400 when conversation is not platform-type', async () => {
    const { service, conversationRepository } = buildService();
    conversationRepository.findOne.mockResolvedValueOnce(
      makeConversation({ type: ChatConversationType.Expert }),
    );
    await expect(
      service.sendPlatformMessage('client-1', 'conv-1', {
        text: 'hi',
      } as never),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects with 403 when user is not a member', async () => {
    const { service, conversationRepository, participantRepository } =
      buildService();
    conversationRepository.findOne.mockResolvedValueOnce(makeConversation());
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
    conversationRepository.findOne.mockResolvedValueOnce(makeConversation());
    participantRepository.findOne.mockResolvedValueOnce({
      conversationId: 'conv-1',
      userId: 'client-1',
      role: ChatParticipantRole.Client,
    });
    participantRepository.find.mockResolvedValueOnce([
      { userId: 'client-1', role: ChatParticipantRole.Client },
      { userId: AI_SYSTEM_USER_ID, role: ChatParticipantRole.Ai },
    ]);
    messageRepository.save.mockResolvedValueOnce({
      id: 'client-msg-42',
      conversationId: 'conv-1',
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
    // Recipients are resolved by the orchestrator at emit time so a revoke
    // during AI generation cuts off delivery — they are no longer part of
    // the scheduleReply payload.
    expect(arg.recipientIds).toBeUndefined();
  });

  it('expert message does NOT trigger the AI orchestrator', async () => {
    const {
      service,
      conversationRepository,
      participantRepository,
      aiOrchestrator,
    } = buildService();
    conversationRepository.findOne.mockResolvedValueOnce(makeConversation());
    participantRepository.findOne.mockResolvedValueOnce({
      conversationId: 'conv-1',
      userId: 'expert-1',
      role: ChatParticipantRole.Expert,
    });
    participantRepository.find.mockResolvedValueOnce([
      { userId: 'client-1', role: ChatParticipantRole.Client },
      { userId: 'expert-1', role: ChatParticipantRole.Expert },
      { userId: AI_SYSTEM_USER_ID, role: ChatParticipantRole.Ai },
    ]);
    await service.sendPlatformMessage('expert-1', 'conv-1', {
      text: 'Let me help',
    } as never);
    expect(aiOrchestrator.scheduleReply).not.toHaveBeenCalled();
  });
});

describe('ChatService.addExpertToClientPlatformChat', () => {
  it('creates the client conversation (with welcome) if missing, then adds the expert as participant', async () => {
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

    await service.addExpertToClientPlatformChat('client-1', 'expert-99');

    // Welcome message was written by the transaction manager.
    const savedTexts = messageRepository.save.mock.calls.map((c) => c[0].text);
    expect(savedTexts).toContain(AI_WELCOME_MESSAGE);

    // Expert was registered as a participant with role expert.
    const expertParticipant = participantRepository.save.mock.calls
      .flat()
      .find((entity: { userId?: string }) => entity?.userId === 'expert-99');
    expect(expertParticipant).toEqual(
      expect.objectContaining({
        userId: 'expert-99',
        role: ChatParticipantRole.Expert,
      }),
    );
  });
});

describe('ChatService.removeExpertFromClientPlatformChat', () => {
  it('is a no-op when the client has no platform conversation yet', async () => {
    const { service, participantRepository } = buildService({
      existingConversation: null,
    });

    await service.removeExpertFromClientPlatformChat('client-1', 'expert-99');

    expect(participantRepository.save).not.toHaveBeenCalled();
  });

  it('deletes only the expert participant when the conversation exists', async () => {
    const conversationRow = {
      id: 'conv-1',
      type: ChatConversationType.Platform,
      participantOneId: AI_SYSTEM_USER_ID,
      participantTwoId: 'client-1',
      orderId: null,
    };
    const { service, participantRepository, conversationRepository } =
      buildService({
        existingConversation: conversationRow,
      });
    (participantRepository as unknown as { delete: jest.Mock }).delete = jest
      .fn()
      .mockResolvedValue({ affected: 1 });

    await service.removeExpertFromClientPlatformChat('client-1', 'expert-99');

    expect(conversationRepository.findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          type: ChatConversationType.Platform,
        }),
      }),
    );
    expect(
      (participantRepository as unknown as { delete: jest.Mock }).delete,
    ).toHaveBeenCalledWith({
      conversationId: 'conv-1',
      userId: 'expert-99',
      role: ChatParticipantRole.Expert,
    });
  });
});
