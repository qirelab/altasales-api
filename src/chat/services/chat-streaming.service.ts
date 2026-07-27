import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { WebSocketGatewayService } from '../../websocket/websocket.gateway';
import { AI_SYSTEM_USER_ID } from '../chat.constants';
import { SendPlatformMessageDto } from '../dto/send-platform-message.dto';
import { ChatConversation } from '../entities/chat-conversation.entity';
import { ChatConversationParticipant } from '../entities/chat-conversation-participant.entity';
import { ChatConversationType } from '../entities/chat-conversation-type.enum';
import { ChatMessage } from '../entities/chat-message.entity';
import { ChatParticipantRole } from '../entities/chat-participant-role.enum';
import {
  AiChatOrchestratorService,
  StreamReplyHooks,
} from './ai-chat-orchestrator.service';

export type StreamPlatformMessageHooks = {
  onClientMessage: (_message: ChatMessage) => void;
  onDelta: (_content: string) => void;
  onDone: (_aiMessage: ChatMessage) => void;
  onRefusal: (_aiMessage: ChatMessage, _refusalReason: string) => void;
  onError: (_reason: string) => void;
};

/**
 * Streaming counterpart of `ChatService.sendPlatformMessage`.
 *
 * The client's message is persisted synchronously and echoed via WS exactly
 * like the non-streaming path; the AI reply is then generated through
 * `AiChatOrchestratorService.streamReply` and pushed back through hooks so
 * the SSE controller can flush chunks to the connected client.
 *
 * All authorization checks (existence, type, membership, client-role) mirror
 * `sendPlatformMessage` so a streaming request can never bypass what the
 * regular endpoint enforces.
 */
@Injectable()
export class ChatStreamingService {
  private readonly logger = new Logger(ChatStreamingService.name);

  constructor(
    @InjectRepository(ChatConversation)
    private readonly conversationRepository: Repository<ChatConversation>,
    @InjectRepository(ChatMessage)
    private readonly messageRepository: Repository<ChatMessage>,
    @InjectRepository(ChatConversationParticipant)
    private readonly participantRepository: Repository<ChatConversationParticipant>,
    private readonly wsGateway: WebSocketGatewayService,
    private readonly aiOrchestrator: AiChatOrchestratorService,
  ) {}

  async streamPlatformMessage(
    userId: string,
    conversationId: string,
    dto: SendPlatformMessageDto,
    hooks: StreamPlatformMessageHooks,
  ): Promise<void> {
    const conversation = await this.conversationRepository.findOne({
      where: { id: conversationId },
    });
    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }
    if (conversation.type !== ChatConversationType.Platform) {
      throw new BadRequestException(
        'This endpoint accepts only platform-type conversations',
      );
    }

    const membership = await this.participantRepository.findOne({
      where: { conversationId: conversation.id, userId },
    });
    if (!membership) {
      throw new ForbiddenException(
        'You are not a participant of this conversation',
      );
    }
    if (membership.role !== ChatParticipantRole.Client) {
      // Streaming is a client-only surface. Expert / operator replies remain
      // on the regular sendPlatformMessage path because they never trigger AI.
      throw new BadRequestException(
        'Streaming is available only for client-authored messages',
      );
    }

    const clientMessage = this.messageRepository.create({
      conversationId: conversation.id,
      senderId: userId,
      text: dto.text,
    });
    const savedClientMessage = await this.messageRepository.save(clientMessage);

    const now = new Date();
    await this.conversationRepository.update(conversation.id, {
      updatedAt: now,
    });

    const otherParticipants = await this.resolveOtherParticipantIds(
      conversation,
      userId,
    );
    const clientMessagePayload = {
      message: { ...savedClientMessage, files: [] },
      conversation: { id: conversation.id, updatedAt: now },
    };
    // Broadcast the client's message to every other participant AND to a
    // duplicate socket the same user might have open elsewhere. The active
    // SSE connection gets its own inline event via onClientMessage.
    this.wsGateway.emitToUser(userId, 'chat:new_message', clientMessagePayload);
    for (const recipientId of otherParticipants) {
      this.wsGateway.emitToUser(
        recipientId,
        'chat:new_message',
        clientMessagePayload,
      );
    }
    hooks.onClientMessage(savedClientMessage);

    const orchestratorHooks: StreamReplyHooks = {
      onDelta: hooks.onDelta,
      onDone: hooks.onDone,
      onRefusal: hooks.onRefusal,
      onError: (reason) => {
        this.logger.warn(
          `Streaming reply produced error for conversation ${conversation.id}: ${reason}`,
        );
        hooks.onError(reason);
      },
    };

    await this.aiOrchestrator.streamReply(
      {
        conversation,
        clientUserId: userId,
        clientMessageId: savedClientMessage.id,
        question: dto.text,
      },
      orchestratorHooks,
    );
  }

  private async resolveOtherParticipantIds(
    conversation: ChatConversation,
    excludeUserId: string,
  ): Promise<string[]> {
    const participants = await this.participantRepository.find({
      where: { conversationId: conversation.id },
    });
    return participants
      .map((p) => p.userId)
      .filter((id) => id !== excludeUserId && id !== AI_SYSTEM_USER_ID);
  }
}
