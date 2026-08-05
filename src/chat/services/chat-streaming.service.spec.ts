import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { AI_SYSTEM_USER_ID } from '../chat.constants';
import { ChatSessionType } from '../entities/chat-session-type.enum';
import { ChatParticipantRole } from '../entities/chat-participant-role.enum';
import { ChatStreamingService } from './chat-streaming.service';

function buildService(
  overrides: {
    conversation?: unknown;
    membership?: unknown;
    participants?: { userId: string }[];
    orchestratorStream?: jest.Mock;
  } = {},
) {
  const conversationRepository = {
    findOne: jest
      .fn()
      .mockResolvedValue(
        overrides.conversation === undefined
          ? { id: 'conv-1', type: ChatSessionType.Platform }
          : overrides.conversation,
      ),
    update: jest.fn().mockResolvedValue(undefined),
  };
  const messageRepository = {
    create: jest.fn((entity) => ({ ...entity, id: 'client-msg-1' })),
    save: jest.fn(async (entity) => ({ ...entity })),
  };
  const defaultMembership = {
    sessionId: 'conv-1',
    userId: 'client-1',
    role: ChatParticipantRole.Client,
  };
  const membership =
    overrides.membership === undefined
      ? defaultMembership
      : overrides.membership;
  const participantRepository = {
    findOne: jest.fn().mockResolvedValue(membership),
    find: jest
      .fn()
      .mockResolvedValue(
        overrides.participants ?? [
          { userId: 'client-1' },
          { userId: 'expert-1' },
          { userId: AI_SYSTEM_USER_ID },
        ],
      ),
  };
  const wsGateway = {
    emitToUser: jest.fn(),
  };
  const aiOrchestrator = {
    streamReply:
      overrides.orchestratorStream ?? jest.fn().mockResolvedValue(undefined),
  };
  const sessionTitleService = {
    generateAndAssign: jest.fn().mockResolvedValue(undefined),
  };
  const service = new ChatStreamingService(
    conversationRepository as never,
    messageRepository as never,
    participantRepository as never,
    wsGateway as never,
    aiOrchestrator as never,
    sessionTitleService as never,
  );
  return {
    service,
    sessionTitleService,
    conversationRepository,
    messageRepository,
    participantRepository,
    wsGateway,
    aiOrchestrator,
  };
}

const hooks = {
  onClientMessage: jest.fn(),
  onDelta: jest.fn(),
  onDone: jest.fn(),
  onRefusal: jest.fn(),
  onError: jest.fn(),
};

describe('ChatStreamingService.validate', () => {
  it('returns a validated context for a Client-role participant of a platform conversation', async () => {
    const { service } = buildService();

    const context = await service.validate('client-1', 'conv-1', {
      text: 'Hi',
    });

    expect(context).toMatchObject({
      conversation: expect.objectContaining({ id: 'conv-1' }),
      userId: 'client-1',
      text: 'Hi',
    });
  });

  it('rejects with NotFound when the conversation does not exist', async () => {
    const { service } = buildService({ conversation: null });

    await expect(
      service.validate('client-1', 'conv-1', { text: 'Hi' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('accepts expert-type conversations for streaming', async () => {
    const { service } = buildService({
      conversation: { id: 'conv-1', type: ChatSessionType.Expert },
    });

    await expect(
      service.validate('client-1', 'conv-1', { text: 'Hi' }),
    ).resolves.toEqual(
      expect.objectContaining({
        conversation: expect.objectContaining({ type: ChatSessionType.Expert }),
        userId: 'client-1',
        text: 'Hi',
      }),
    );
  });

  it('rejects with Forbidden when the caller is not a participant', async () => {
    const { service } = buildService({ membership: null });

    await expect(
      service.validate('stranger', 'conv-1', { text: 'Hi' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects with BadRequest when the DTO carries fileIds (streaming is text-only)', async () => {
    const { service } = buildService();

    await expect(
      service.validate('client-1', 'conv-1', {
        text: 'Hi',
        fileIds: ['00000000-0000-4000-8000-000000000001'],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects with BadRequest when the caller is not a Client', async () => {
    const { service } = buildService({
      membership: {
        sessionId: 'conv-1',
        userId: 'expert-1',
        role: ChatParticipantRole.Expert,
      },
    });

    await expect(
      service.validate('expert-1', 'conv-1', { text: 'Hi' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('ChatStreamingService.runStream', () => {
  beforeEach(() => {
    for (const value of Object.values(hooks)) value.mockReset();
  });

  it('persists the client message and delegates to the orchestrator (signal forwarded)', async () => {
    const {
      service,
      messageRepository,
      wsGateway,
      aiOrchestrator,
      conversationRepository,
    } = buildService();
    const context = await service.validate('client-1', 'conv-1', {
      text: 'Hi',
    });
    const controller = new AbortController();

    await service.runStream(context, hooks, controller.signal);

    expect(messageRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'Hi', senderId: 'client-1' }),
    );
    expect(conversationRepository.update).toHaveBeenCalled();
    expect(hooks.onClientMessage).toHaveBeenCalledTimes(1);
    expect(aiOrchestrator.streamReply).toHaveBeenCalledWith(
      expect.objectContaining({ clientUserId: 'client-1' }),
      expect.any(Object),
      controller.signal,
    );
    // WS emit target set: streaming client (own other tabs) + expert, but
    // never the system AI user.
    const targets = wsGateway.emitToUser.mock.calls.map((call) => call[0]);
    expect(targets.sort()).toEqual(['client-1', 'expert-1'].sort());
    expect(targets).not.toContain(AI_SYSTEM_USER_ID);
  });

  it('schedules AI title generation on the first client streaming message when title is null', async () => {
    const { service, sessionTitleService } = buildService({
      conversation: {
        id: 'conv-1',
        type: ChatSessionType.Platform,
        title: null,
      },
    });
    const context = await service.validate('client-1', 'conv-1', {
      text: 'Как настроить отдел продаж?',
    });

    await service.runStream(context, hooks);

    expect(sessionTitleService.generateAndAssign).toHaveBeenCalledWith(
      'conv-1',
      'Как настроить отдел продаж?',
    );
  });

  it('does NOT trigger AI title generation when the session already has a title', async () => {
    const { service, sessionTitleService } = buildService({
      conversation: {
        id: 'conv-1',
        type: ChatSessionType.Platform,
        title: 'Existing topic',
      },
    });
    const context = await service.validate('client-1', 'conv-1', {
      text: 'follow-up question',
    });

    await service.runStream(context, hooks);

    expect(sessionTitleService.generateAndAssign).not.toHaveBeenCalled();
  });

  it('WS payload uses "session" key with id/updatedAt/title on the streaming path', async () => {
    const { service, wsGateway } = buildService({
      conversation: {
        id: 'conv-1',
        type: ChatSessionType.Platform,
        title: 'Preset',
      },
    });
    const context = await service.validate('client-1', 'conv-1', {
      text: 'first message',
    });

    await service.runStream(context, hooks);

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

  it('reports client_message_persist_failed when saving the client message throws', async () => {
    const { service, messageRepository, aiOrchestrator } = buildService();
    messageRepository.save.mockRejectedValueOnce(new Error('db down'));
    const context = await service.validate('client-1', 'conv-1', {
      text: 'Hi',
    });

    await service.runStream(context, hooks);

    expect(hooks.onError).toHaveBeenCalledWith('client_message_persist_failed');
    expect(aiOrchestrator.streamReply).not.toHaveBeenCalled();
  });
});
