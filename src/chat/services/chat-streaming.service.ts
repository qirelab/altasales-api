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

export type ValidatedStreamContext = {
  conversation: ChatConversation;
  userId: string;
  text: string;
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

  /**
   * Pre-flight validation. Runs the same guards as `sendPlatformMessage` and
   * throws NotFound / Forbidden / BadRequest so Nest can serialise them as
   * real HTTP responses BEFORE the caller flushes SSE headers. Once the SSE
   * body has started, any error there has to be reported as `event: error`
   * with HTTP 200 — which prevents the client from telling permission
   * problems from generation failures at the network layer.
   */
  async validate(
    userId: string,
    conversationId: string,
    dto: SendPlatformMessageDto,
  ): Promise<ValidatedStreamContext> {
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
    if (dto.fileIds?.length) {
      // The streaming endpoint is text-only for now. The non-streaming
      // sendPlatformMessage path already handles attachments; silently
      // accepting fileIds here would drop the files without warning because
      // `runStream` does not thread them through to `filesService.linkToMessage`.
      throw new BadRequestException(
        'File attachments are not supported on the streaming endpoint. ' +
          'Use POST /chat/conversations/:id/messages instead.',
      );
    }

    return { conversation, userId, text: dto.text };
  }

  /**
   * Runs after `validate` succeeded. Persists the client message, broadcasts
   * it, and delegates the AI reply to the orchestrator. The optional
   * `signal` is threaded down to `provider.streamChat` so a client disconnect
   * (or a mid-stream policy violation) cancels the upstream LLM request
   * instead of letting it keep burning tokens.
   *
   * Never throws — all errors travel through `hooks.onError`.
   */
  async runStream(
    context: ValidatedStreamContext,
    hooks: StreamPlatformMessageHooks,
    signal?: AbortSignal,
  ): Promise<void> {
    const { conversation, userId, text } = context;
    let savedClientMessage: ChatMessage;
    try {
      const clientMessage = this.messageRepository.create({
        conversationId: conversation.id,
        senderId: userId,
        text,
      });
      savedClientMessage = await this.messageRepository.save(clientMessage);

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
      this.wsGateway.emitToUser(
        userId,
        'chat:new_message',
        clientMessagePayload,
      );
      for (const recipientId of otherParticipants) {
        this.wsGateway.emitToUser(
          recipientId,
          'chat:new_message',
          clientMessagePayload,
        );
      }
      hooks.onClientMessage(savedClientMessage);
    } catch (error) {
      this.logger.error(
        `Failed to persist streaming client message for conversation ${conversation.id}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      hooks.onError('client_message_persist_failed');
      return;
    }

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
        question: text,
      },
      orchestratorHooks,
      signal,
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
