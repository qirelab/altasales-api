import { ChatHandoffStatus } from '../entities/chat-handoff-status.enum';
import { ChatSessionType } from '../entities/chat-session-type.enum';
import { HANDOFF_TIMEOUT_RESUME_MESSAGE } from '../chat.constants';
import { HandoffService } from './handoff.service';

describe('HandoffService.resumeTimedOutHandoffs', () => {
  function buildService(
    opts: {
      candidates?: Array<Record<string, unknown>>;
      humanReply?: Record<string, unknown> | null;
      updateAffected?: number;
    } = {},
  ) {
    const candidates = opts.candidates ?? [
      {
        id: 'sess-timeout',
        type: ChatSessionType.Platform,
        title: null,
        handoffStatus: ChatHandoffStatus.Awaiting,
        handoffRequestedAt: new Date(Date.now() - 20 * 60 * 1000),
        assignedOperator: null,
      },
    ];

    const sessionRepository = {
      createQueryBuilder: jest.fn((alias?: string) => {
        if (alias === 's') {
          return {
            where: jest.fn().mockReturnThis(),
            andWhere: jest.fn().mockReturnThis(),
            take: jest.fn().mockReturnThis(),
            getMany: jest.fn().mockResolvedValue(candidates),
          };
        }
        return {
          update: jest.fn().mockReturnThis(),
          set: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          execute: jest.fn().mockResolvedValue({
            affected: opts.updateAffected ?? 1,
          }),
        };
      }),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      findOne: jest.fn().mockResolvedValue({
        ...candidates[0],
        handoffStatus: ChatHandoffStatus.Resolved,
      }),
    };

    const participantRepository = {
      find: jest
        .fn()
        .mockResolvedValue([
          { userId: 'client-1' },
          { userId: '00000000-0000-0000-0000-00000000a1a1' },
        ]),
    };

    const savedMessages: Array<Record<string, unknown>> = [];
    const messageRepository = {
      createQueryBuilder: jest.fn(() => ({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(opts.humanReply ?? null),
      })),
      create: jest.fn((e) => e),
      save: jest.fn(async (entity: Record<string, unknown>) => {
        const saved = {
          ...entity,
          id: 'timeout-msg',
          createdAt: new Date(),
        };
        savedMessages.push(saved);
        return saved;
      }),
    };

    const dataSource = { transaction: jest.fn() };
    const wsGateway = { emitToUser: jest.fn() };
    const configService = {
      get: jest.fn().mockReturnValue('900000'),
    };

    const service = new HandoffService(
      sessionRepository as never,
      participantRepository as never,
      messageRepository as never,
      dataSource as never,
      wsGateway as never,
      configService as never,
    );

    return { service, wsGateway, savedMessages, sessionRepository };
  }

  it('resolves timed-out handoffs without human reply and resumes AI notice', async () => {
    const { service, wsGateway, savedMessages } = buildService();
    const resumed = await service.resumeTimedOutHandoffs();
    expect(resumed).toBe(1);
    expect(savedMessages[0].text).toBe(HANDOFF_TIMEOUT_RESUME_MESSAGE);
    const events = wsGateway.emitToUser.mock.calls.map((c) => c[1]);
    expect(events).toContain('chat:new_message');
    expect(events).toContain('chat:handoff_resolved');
  });

  it('skips sessions that already got a human reply after handoff request', async () => {
    const { service, savedMessages } = buildService({
      humanReply: { id: 'human-1' },
    });
    const resumed = await service.resumeTimedOutHandoffs();
    expect(resumed).toBe(0);
    expect(savedMessages).toHaveLength(0);
  });

  it('isAiPausedByHandoff is true for awaiting and in_progress', () => {
    const { service } = buildService();
    expect(
      service.isAiPausedByHandoff({
        handoffStatus: ChatHandoffStatus.Awaiting,
      }),
    ).toBe(true);
    expect(
      service.isAiPausedByHandoff({
        handoffStatus: ChatHandoffStatus.InProgress,
      }),
    ).toBe(true);
    expect(
      service.isAiPausedByHandoff({
        handoffStatus: ChatHandoffStatus.Resolved,
      }),
    ).toBe(false);
    expect(service.isAiPausedByHandoff({ handoffStatus: null })).toBe(false);
  });

  it('ensureExpertActiveOnReply activates a quiet resolved session', async () => {
    const session = {
      id: 'sess-quiet',
      type: ChatSessionType.Expert,
      title: 'Аудит',
      handoffStatus: ChatHandoffStatus.Resolved,
      assignedOperatorId: null,
      assignedOperator: null,
    };
    const sessionRepository = {
      findOne: jest
        .fn()
        .mockResolvedValueOnce(session)
        .mockResolvedValueOnce({
          ...session,
          handoffStatus: ChatHandoffStatus.InProgress,
          assignedOperatorId: 'expert-1',
          assignedOperator: {
            id: 'expert-1',
            name: 'Пётр',
            lastName: 'Эксперт',
            email: 'e@x',
          },
        }),
      createQueryBuilder: jest.fn(() => ({
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({ affected: 1 }),
      })),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    const participantRepository = {
      find: jest
        .fn()
        .mockResolvedValue([{ userId: 'client-1' }, { userId: 'expert-1' }]),
      findOne: jest.fn().mockResolvedValue({
        userId: 'expert-1',
        role: 'expert',
      }),
    };
    const savedMessages: Array<Record<string, unknown>> = [];
    const messageRepository = {
      create: jest.fn((e) => e),
      save: jest.fn(async (e: Record<string, unknown>) => {
        const saved = { ...e, id: 'ann-1', createdAt: new Date() };
        savedMessages.push(saved);
        return saved;
      }),
      createQueryBuilder: jest.fn(),
    };
    const service = new HandoffService(
      sessionRepository as never,
      participantRepository as never,
      messageRepository as never,
      { transaction: jest.fn() } as never,
      { emitToUser: jest.fn() } as never,
      { get: jest.fn() } as never,
    );

    const result = await service.ensureExpertActiveOnReply(
      'sess-quiet',
      'expert-1',
    );
    expect(result).toBe('activated');
    expect(savedMessages[0].text).toContain('подключился эксперт');
  });
});
