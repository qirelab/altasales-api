import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { AI_SYSTEM_USER_ID } from '../chat.constants';
import { ChatConversationType } from '../entities/chat-conversation-type.enum';
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
          ? { id: 'conv-1', type: ChatConversationType.Platform }
          : overrides.conversation,
      ),
    update: jest.fn().mockResolvedValue(undefined),
  };
  const messageRepository = {
    create: jest.fn((entity) => ({ ...entity, id: 'client-msg-1' })),
    save: jest.fn(async (entity) => ({ ...entity })),
  };
  const defaultMembership = {
    conversationId: 'conv-1',
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
  const service = new ChatStreamingService(
    conversationRepository as never,
    messageRepository as never,
    participantRepository as never,
    wsGateway as never,
    aiOrchestrator as never,
  );
  return {
    service,
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

  it('rejects with BadRequest for a non-platform conversation', async () => {
    const { service } = buildService({
      conversation: { id: 'conv-1', type: ChatConversationType.Expert },
    });

    await expect(
      service.validate('client-1', 'conv-1', { text: 'Hi' }),
    ).rejects.toBeInstanceOf(BadRequestException);
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
        conversationId: 'conv-1',
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
