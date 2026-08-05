import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { ChatHandoffStatus } from '../entities/chat-handoff-status.enum';
import { ChatParticipantRole } from '../entities/chat-participant-role.enum';
import { ChatSessionType } from '../entities/chat-session-type.enum';
import { ExpertChatService } from './expert-chat.service';
import { HandoffService } from './handoff.service';

function makeSession(overrides: Record<string, unknown> = {}) {
  return {
    id: 'expert-sess-1',
    type: ChatSessionType.Expert,
    title: 'Аудит воронки',
    orderId: 'order-1',
    updatedAt: new Date('2026-07-01T12:00:00Z'),
    participantOne: {
      id: 'client-1',
      name: 'Иван',
      lastName: 'Иванов',
      email: 'client@example.com',
    },
    participantTwo: {
      id: 'expert-1',
      name: 'Пётр',
      lastName: 'Эксперт',
      email: 'expert@example.com',
    },
    assignedOperator: null,
    assignedOperatorId: null,
    needsHumanHandoff: true,
    handoffStatus: ChatHandoffStatus.Awaiting,
    handoffRequestedAt: new Date('2026-07-01T11:00:00Z'),
    handoffClaimedAt: null,
    handoffResolvedAt: null,
    ...overrides,
  };
}

function buildService(
  opts: {
    session?: ReturnType<typeof makeSession>;
    listRows?: ReturnType<typeof makeSession>[];
  } = {},
) {
  const session = opts.session ?? makeSession();
  let currentSession = session;
  const savedMessages: Array<Record<string, unknown>> = [];

  const sessionRepository = {
    findOne: jest.fn(async () => currentSession),
    createQueryBuilder: jest.fn(() => {
      const qb = {
        innerJoin: jest.fn().mockReturnThis(),
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue(opts.listRows ?? [session]),
        update: jest.fn().mockReturnThis(),
        set: jest.fn((patch: Record<string, unknown>) => {
          currentSession = { ...currentSession, ...patch };
          return {
            where: jest.fn().mockReturnThis(),
            andWhere: jest.fn().mockReturnThis(),
            execute: jest.fn().mockResolvedValue({ affected: 1 }),
          };
        }),
      };
      return qb;
    }),
    update: jest.fn().mockResolvedValue({ affected: 1 }),
  };

  const participantRepository = {
    find: jest.fn().mockResolvedValue([
      { userId: 'client-1', role: ChatParticipantRole.Client },
      { userId: 'expert-1', role: ChatParticipantRole.Expert },
    ]),
    findOne: jest.fn().mockResolvedValue({
      userId: 'expert-1',
      role: ChatParticipantRole.Expert,
    }),
    save: jest.fn(),
    create: jest.fn((e) => e),
  };

  const messageRepository = {
    findOne: jest.fn().mockResolvedValue(null),
    save: jest.fn(async (entity: Record<string, unknown>) => {
      const saved = {
        ...entity,
        id: `msg-${savedMessages.length + 1}`,
        createdAt: new Date(),
      };
      savedMessages.push(saved);
      return saved;
    }),
    create: jest.fn((e) => e),
    createQueryBuilder: jest.fn(() => ({
      distinctOn: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([]),
      getOne: jest.fn().mockResolvedValue(null),
    })),
  };

  const questionnaireRepository = {
    findOne: jest.fn().mockResolvedValue(null),
    find: jest.fn().mockResolvedValue([]),
  };

  const dataSource = {
    transaction: jest.fn(async (cb: (m: unknown) => Promise<unknown>) => {
      const manager = {
        createQueryBuilder: sessionRepository.createQueryBuilder,
        getRepository: () => participantRepository,
      };
      return cb(manager);
    }),
  };

  const wsGateway = { emitToUser: jest.fn() };
  const configService = { get: jest.fn() };

  const handoffService = new HandoffService(
    sessionRepository as never,
    participantRepository as never,
    messageRepository as never,
    dataSource as never,
    wsGateway as never,
    configService as never,
  );

  const chatService = {
    ensureExpertSessionsForUser: jest.fn().mockResolvedValue(undefined),
  };

  const service = new ExpertChatService(
    sessionRepository as never,
    messageRepository as never,
    questionnaireRepository as never,
    handoffService,
    chatService as never,
  );

  return {
    service,
    sessionRepository,
    wsGateway,
    savedMessages,
    handoffService,
  };
}

describe('ExpertChatService', () => {
  it('lists only expert sessions for the given expert', async () => {
    const { service, sessionRepository } = buildService({
      listRows: [makeSession()],
    });
    const rows = await service.listExpertSessions('expert-1', 'active');
    expect(rows).toHaveLength(1);
    expect(rows[0].type).toBe(ChatSessionType.Expert);
    expect(rows[0].assignedExpertId).toBeNull();
    expect(sessionRepository.createQueryBuilder).toHaveBeenCalled();
  });

  it('claims an awaiting expert session', async () => {
    const { service, wsGateway, savedMessages } = buildService({
      session: makeSession({ handoffStatus: ChatHandoffStatus.Awaiting }),
    });
    const handoff = (service as unknown as { handoffService: HandoffService })
      .handoffService;
    const hs = handoff as unknown as {
      sessionRepository: { findOne: jest.Mock };
    };
    hs.sessionRepository.findOne
      .mockResolvedValueOnce(
        makeSession({ handoffStatus: ChatHandoffStatus.Awaiting }),
      )
      .mockResolvedValueOnce(
        makeSession({
          handoffStatus: ChatHandoffStatus.InProgress,
          assignedOperatorId: 'expert-1',
          assignedOperator: {
            id: 'expert-1',
            name: 'Пётр',
            lastName: 'Эксперт',
            email: 'expert@example.com',
          },
        }),
      );

    const view = await service.claim('expert-1', 'expert-sess-1');
    expect(view.assignedExpertId).toBe('expert-1');
    expect(savedMessages[0].text).toContain('эксперт');
    expect(wsGateway.emitToUser.mock.calls.map((c) => c[1])).toContain(
      'chat:handoff_claimed',
    );
  });

  it('rejects claim when expert is not a participant', async () => {
    const { service, handoffService } = buildService();
    const hs = handoffService as unknown as {
      participantRepository: { findOne: jest.Mock };
      sessionRepository: { findOne: jest.Mock };
    };
    hs.sessionRepository.findOne.mockResolvedValueOnce(
      makeSession({ handoffStatus: ChatHandoffStatus.Awaiting }),
    );
    hs.participantRepository.findOne.mockResolvedValueOnce(null);
    await expect(service.claim('stranger', 'expert-sess-1')).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('resolves in_progress sessions', async () => {
    const { service, wsGateway, savedMessages } = buildService({
      session: makeSession({
        handoffStatus: ChatHandoffStatus.InProgress,
        assignedOperatorId: 'expert-1',
        assignedOperator: {
          id: 'expert-1',
          name: 'Пётр',
          lastName: 'Эксперт',
          email: 'expert@example.com',
        },
      }),
    });
    await service.resolve('expert-1', 'expert-sess-1');
    expect(wsGateway.emitToUser.mock.calls.map((c) => c[1])).toContain(
      'chat:handoff_resolved',
    );
    expect(wsGateway.emitToUser.mock.calls.map((c) => c[1])).toContain(
      'chat:new_message',
    );
    expect(
      savedMessages.some(
        (m) =>
          String(m.text).includes('Эксперт') &&
          String(m.text).includes('покинул чат'),
      ),
    ).toBe(true);
  });

  it('rejects resolve for another assignee', async () => {
    const { service } = buildService({
      session: makeSession({
        handoffStatus: ChatHandoffStatus.InProgress,
        assignedOperatorId: 'other-expert',
      }),
    });
    await expect(service.resolve('expert-1', 'expert-sess-1')).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('rejects claim when not awaiting', async () => {
    const { service } = buildService({
      session: makeSession({ handoffStatus: ChatHandoffStatus.Resolved }),
    });
    await expect(service.claim('expert-1', 'expert-sess-1')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('throws Conflict when another expert already claimed', async () => {
    const { service } = buildService({
      session: makeSession({
        handoffStatus: ChatHandoffStatus.InProgress,
        assignedOperatorId: 'other-expert',
      }),
    });
    await expect(service.claim('expert-1', 'expert-sess-1')).rejects.toThrow(
      ConflictException,
    );
  });
});
