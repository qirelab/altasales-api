import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ChatConversationType } from '../entities/chat-conversation-type.enum';
import { ChatParticipantRole } from '../entities/chat-participant-role.enum';
import { ChatStreamingService } from './chat-streaming.service';

function buildService(overrides: {
  conversation?: unknown;
  membership?: unknown;
  orchestratorStream?: jest.Mock;
} = {}) {
  const conversationRepository = {
    findOne: jest.fn().mockResolvedValue(
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
  const participantRepository = {
    findOne: jest.fn().mockResolvedValue(
      overrides.membership === undefined
        ? { conversationId: 'conv-1', userId: 'client-1', role: ChatParticipantRole.Client }
        : overrides.membership,
    ),
    find: jest.fn().mockResolvedValue([
      { userId: 'client-1' },
      { userId: 'expert-1' },
    ]),
  };
  const wsGateway = {
    emitToUser: jest.fn(),
  };
  const aiOrchestrator = {
    streamReply: overrides.orchestratorStream ?? jest.fn().mockResolvedValue(undefined),
  };
  const service = new ChatStreamingService(
    conversationRepository as never,
    messageRepository as never,
    participantRepository as never,
    wsGateway as never,
    aiOrchestrator as never,
  );
  return { service, conversationRepository, messageRepository, participantRepository, wsGateway, aiOrchestrator };
}

const hooks = {
  onClientMessage: jest.fn(),
  onDelta: jest.fn(),
  onDone: jest.fn(),
  onRefusal: jest.fn(),
  onError: jest.fn(),
};

describe('ChatStreamingService.streamPlatformMessage', () => {
  beforeEach(() => {
    for (const value of Object.values(hooks)) value.mockReset();
  });

  it('persists the client message, echoes it via WS to other participants, and delegates to the orchestrator', async () => {
    const { service, messageRepository, wsGateway, aiOrchestrator } = buildService();

    await service.streamPlatformMessage('client-1', 'conv-1', { text: 'Привет' }, hooks);

    expect(messageRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'Привет', senderId: 'client-1' }),
    );
    // Expert receives the client message via WS, AI system user does NOT.
    const targets = wsGateway.emitToUser.mock.calls.map((call) => call[0]);
    expect(targets).toContain('expert-1');
    expect(targets).toContain('client-1'); // own other tabs
    expect(hooks.onClientMessage).toHaveBeenCalledTimes(1);
    expect(aiOrchestrator.streamReply).toHaveBeenCalledTimes(1);
  });

  it('rejects a request when the conversation does not exist', async () => {
    const { service } = buildService({ conversation: null });

    await expect(
      service.streamPlatformMessage('client-1', 'conv-1', { text: 'Hi' }, hooks),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects a request for a non-platform conversation', async () => {
    const { service } = buildService({
      conversation: { id: 'conv-1', type: ChatConversationType.Expert },
    });

    await expect(
      service.streamPlatformMessage('client-1', 'conv-1', { text: 'Hi' }, hooks),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a caller that is not a participant', async () => {
    const { service } = buildService({ membership: null });

    await expect(
      service.streamPlatformMessage('stranger', 'conv-1', { text: 'Hi' }, hooks),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects a caller whose role is not Client (expert/operator cannot use SSE)', async () => {
    const { service } = buildService({
      membership: { conversationId: 'conv-1', userId: 'expert-1', role: ChatParticipantRole.Expert },
    });

    await expect(
      service.streamPlatformMessage('expert-1', 'conv-1', { text: 'Hi' }, hooks),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
