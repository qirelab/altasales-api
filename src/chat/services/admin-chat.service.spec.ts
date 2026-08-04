import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ChatHandoffStatus } from '../entities/chat-handoff-status.enum';
import { ChatParticipantRole } from '../entities/chat-participant-role.enum';
import { ChatSessionType } from '../entities/chat-session-type.enum';
import { AdminChatService } from './admin-chat.service';

function makeSession(overrides: Record<string, unknown> = {}) {
  return {
    id: overrides.id ?? 'sess-1',
    type: ChatSessionType.Platform,
    title: 'Onboarding',
    updatedAt: new Date('2026-07-01T12:00:00Z'),
    participantOne: {
      id: 'client-1', name: 'Иван', lastName: 'Иванов', email: 'client@example.com',
    },
    participantTwo: { id: '00000000-0000-0000-0000-00000000a1a1', name: 'AI', lastName: '', email: '' },
    assignedOperator: null,
    assignedOperatorId: null,
    needsHumanHandoff: false,
    handoffStatus: ChatHandoffStatus.Awaiting,
    handoffTrigger: null,
    handoffRequestedAt: null,
    handoffClaimedAt: null,
    handoffResolvedAt: null,
    ...overrides,
  };
}

function buildService(opts: {
  session?: ReturnType<typeof makeSession> | null;
  claimAffected?: number;
  resolveAffected?: number;
  existingParticipant?: boolean;
} = {}) {
  const session = opts.session ?? makeSession();
  const savedMessages: Array<Record<string, unknown>> = [];
  const savedParticipants: Array<Record<string, unknown>> = [];
  let currentSession = session;

  const sessionRepository = {
    findOne: jest.fn(async () => currentSession),
    update: jest.fn(async () => ({ affected: 1 })),
    createQueryBuilder: jest.fn(() => ({
      update: jest.fn().mockReturnThis(),
      set: jest.fn((patch: Record<string, unknown>) => {
        if (currentSession) {
          currentSession = { ...currentSession, ...patch };
        }
        return {
          where: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          execute: jest.fn().mockResolvedValue({
            affected: opts.claimAffected ?? opts.resolveAffected ?? 1,
          }),
        };
      }),
    })),
  };

  const participantRepository = {
    find: jest.fn().mockResolvedValue([
      { userId: 'client-1', role: ChatParticipantRole.Client },
    ]),
    findOne: jest.fn().mockResolvedValue(
      opts.existingParticipant ? { userId: 'op-1', role: ChatParticipantRole.Operator } : null,
    ),
    save: jest.fn().mockResolvedValue({}),
    create: jest.fn((entity) => entity),
  };

  const messageRepository = {
    findOne: jest.fn().mockResolvedValue(null),
    save: jest.fn(async (entity: Record<string, unknown>) => {
      const saved = { ...entity, id: `msg-${savedMessages.length + 1}`, createdAt: new Date() };
      savedMessages.push(saved);
      return saved;
    }),
    create: jest.fn((entity: Record<string, unknown>) => entity),
    createQueryBuilder: jest.fn(() => ({
      distinctOn: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([]),
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
        getRepository: (target: unknown) => {
          if (target === (undefined as unknown)) return participantRepository;
          return participantRepository;
        },
      };
      return cb(manager);
    }),
  };

  const wsGateway = { emitToUser: jest.fn() };

  const service = new AdminChatService(
    sessionRepository as never,
    participantRepository as never,
    messageRepository as never,
    questionnaireRepository as never,
    dataSource as never,
    wsGateway as never,
  );

  return {
    service,
    sessionRepository,
    participantRepository,
    messageRepository,
    questionnaireRepository,
    dataSource,
    wsGateway,
    savedMessages,
    savedParticipants,
  };
}

describe('AdminChatService', () => {
  describe('claim', () => {
    it('claims a session in awaiting status and posts an announcement message', async () => {
      const { service, wsGateway, savedMessages } = buildService({
        session: makeSession({ handoffStatus: ChatHandoffStatus.Awaiting }),
      });

      // Session's assignedOperator will be present in the "fresh" load
      // (mock always returns the same object). Preload operator name so
      // postClaimAnnouncement has a full name to render.
      const svc = service as unknown as { sessionRepository: { findOne: jest.Mock } };
      svc.sessionRepository.findOne
        .mockResolvedValueOnce(makeSession({ handoffStatus: ChatHandoffStatus.Awaiting }))
        .mockResolvedValueOnce(makeSession({
          handoffStatus: ChatHandoffStatus.InProgress,
          assignedOperator: { id: 'op-1', name: 'Максим', lastName: 'Оператор', email: 'op@x' },
          assignedOperatorId: 'op-1',
        }));

      await service.claim('op-1', 'sess-1');

      const emittedEvents = wsGateway.emitToUser.mock.calls.map((c) => c[1]);
      expect(emittedEvents).toContain('chat:new_message');
      expect(emittedEvents).toContain('chat:handoff_claimed');
      expect(savedMessages).toHaveLength(1);
      expect(savedMessages[0]).toMatchObject({
        senderId: '00000000-0000-0000-0000-00000000a1a1',
        isAiGenerated: true,
      });
      expect(savedMessages[0].text).toContain('Максим Оператор');
      expect(savedMessages[0].text).toMatch(/^Оператор /);
      expect(savedMessages[0].text).toMatch(/принял ваш запрос/);
    });

    it('throws ConflictException when the session is claimed by another operator', async () => {
      const { service } = buildService({
        session: makeSession({
          handoffStatus: ChatHandoffStatus.InProgress,
          assignedOperatorId: 'other-op',
        }),
      });

      await expect(service.claim('op-1', 'sess-1')).rejects.toThrow(ConflictException);
    });

    it('is idempotent when the same operator re-claims their own session', async () => {
      const { service, savedMessages } = buildService({
        session: makeSession({
          handoffStatus: ChatHandoffStatus.InProgress,
          assignedOperatorId: 'op-1',
        }),
      });

      await service.claim('op-1', 'sess-1');
      expect(savedMessages).toHaveLength(0);
    });

    it('rejects claim on a session that is not awaiting', async () => {
      const { service } = buildService({
        session: makeSession({ handoffStatus: ChatHandoffStatus.Resolved }),
      });
      await expect(service.claim('op-1', 'sess-1')).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException when the session does not exist', async () => {
      const { service, sessionRepository } = buildService();
      sessionRepository.findOne.mockResolvedValueOnce(null);
      await expect(service.claim('op-1', 'missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('resolve', () => {
    it('resolves an in_progress session claimed by the same operator', async () => {
      const { service, wsGateway, savedMessages } = buildService({
        session: makeSession({
          handoffStatus: ChatHandoffStatus.InProgress,
          assignedOperatorId: 'op-1',
          assignedOperator: {
            id: 'op-1', name: 'Максим', lastName: 'Оператор', email: 'op@x',
          },
        }),
      });

      await service.resolve('op-1', 'sess-1');

      const emittedEvents = wsGateway.emitToUser.mock.calls.map((c) => c[1]);
      expect(emittedEvents).toContain('chat:handoff_resolved');
      expect(emittedEvents).toContain('chat:new_message');
      expect(savedMessages).toHaveLength(1);
      expect(savedMessages[0]).toMatchObject({
        senderId: '00000000-0000-0000-0000-00000000a1a1',
        isAiGenerated: true,
      });
      expect(savedMessages[0].text).toContain('Максим Оператор');
      expect(savedMessages[0].text).toMatch(/снова на связи/);
    });

    it('throws ForbiddenException when a different operator tries to resolve', async () => {
      const { service } = buildService({
        session: makeSession({
          handoffStatus: ChatHandoffStatus.InProgress,
          assignedOperatorId: 'other-op',
        }),
      });
      await expect(service.resolve('op-1', 'sess-1')).rejects.toThrow(ForbiddenException);
    });

    it('rejects resolve on a session that is not in_progress', async () => {
      const { service } = buildService({
        session: makeSession({ handoffStatus: ChatHandoffStatus.Awaiting }),
      });
      await expect(service.resolve('op-1', 'sess-1')).rejects.toThrow(BadRequestException);
    });
  });

  describe('listOperatorSessions', () => {
    it('returns an empty array when there are no sessions', async () => {
      const { service, sessionRepository } = buildService();
      sessionRepository.findOne.mockResolvedValueOnce(null);
      (sessionRepository as unknown as { find: jest.Mock }).find = jest.fn().mockResolvedValue([]);

      const rows = await service.listOperatorSessions('active');
      expect(rows).toEqual([]);
    });
  });
});
