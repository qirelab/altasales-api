import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ChatbotRagService } from '../../chatbot/services/chatbot-rag.service';
import { WebSocketGatewayService } from '../../websocket/websocket.gateway';
import { AI_SYSTEM_USER_ID } from '../chat.constants';
import { ChatConversation } from '../entities/chat-conversation.entity';
import { ChatConversationParticipant } from '../entities/chat-conversation-participant.entity';
import { ChatConversationType } from '../entities/chat-conversation-type.enum';
import { ChatMessage } from '../entities/chat-message.entity';
import { ChatHistoryMapperService } from './chat-history-mapper.service';

const HISTORY_FETCH_LIMIT = 40;

type RespondInput = {
  conversation: ChatConversation;
  clientUserId: string;
  clientMessageId: string;
  question: string;
};

/**
 * Async orchestrator for the AI half of a platform conversation.
 *
 * `scheduleReply` is called from ChatService.sendPlatformMessage after the
 * client's own message has been persisted. It runs fire-and-forget, but
 * tasks are serialized per-conversation via `queues` so a client that
 * types two messages in quick succession never has task-2 finish before
 * task-1, and task-1's history never sees the future m2 as "past".
 *
 * Recipient list is resolved right before WS emit (not at schedule time)
 * so an admin who revokes an expert's chat access while the AI is still
 * generating stops that message from reaching the expert.
 */
@Injectable()
export class AiChatOrchestratorService {
  private readonly logger = new Logger(AiChatOrchestratorService.name);
  private readonly queues = new Map<string, Promise<void>>();

  constructor(
    @InjectRepository(ChatMessage)
    private readonly messageRepository: Repository<ChatMessage>,
    @InjectRepository(ChatConversation)
    private readonly conversationRepository: Repository<ChatConversation>,
    @InjectRepository(ChatConversationParticipant)
    private readonly participantRepository: Repository<ChatConversationParticipant>,
    private readonly ragService: ChatbotRagService,
    private readonly historyMapper: ChatHistoryMapperService,
    private readonly wsGateway: WebSocketGatewayService,
  ) {}

  scheduleReply(input: RespondInput): void {
    const conversationId = input.conversation.id;
    const previous = this.queues.get(conversationId) ?? Promise.resolve();
    const next = previous
      .catch(() => undefined)
      .then(() => this.respondToClientMessage(input))
      .catch((error) => {
        this.logger.error(
          `AI chat orchestration crashed for conversation ${conversationId}: ${
            error instanceof Error ? error.message : String(error)
          }`,
          error instanceof Error ? error.stack : undefined,
        );
      });
    this.queues.set(conversationId, next);
    void next.finally(() => {
      if (this.queues.get(conversationId) === next) {
        this.queues.delete(conversationId);
      }
    });
  }

  private async respondToClientMessage(input: RespondInput): Promise<void> {
    const startedAt = Date.now();

    const currentMessage = await this.messageRepository.findOne({
      where: { id: input.clientMessageId },
    });
    if (!currentMessage) {
      // Message was deleted before we could respond; skip.
      return;
    }

    // Only load messages that STRICTLY predate the current turn. Postgres
    // `timestamptz` collisions from the same request loop are possible, so
    // `createdAt <` (strict) is the only race-safe choice: any message that
    // shares the current tick — including a same-tick fast-typing sibling —
    // is excluded from history. Trade-off: a legitimate prior message that
    // shares the tick with the current one is also dropped, which is rare
    // and preferable to leaking a future message into the LLM context.
    const recentMessages = await this.messageRepository
      .createQueryBuilder('m')
      .where('m."conversationId" = :conversationId', {
        conversationId: input.conversation.id,
      })
      .andWhere('m."createdAt" < :cutoff', { cutoff: currentMessage.createdAt })
      .orderBy('m."createdAt"', 'DESC')
      .addOrderBy('m."id"', 'DESC')
      .take(HISTORY_FETCH_LIMIT)
      .getMany();
    const historySource = [...recentMessages].reverse();
    const history = this.historyMapper.toHistoryEntries(
      historySource,
      input.clientUserId,
    );

    const ragResponse = await this.ragService.askQuestion({
      question: input.question,
      history,
    });

    const answerMessage = this.messageRepository.create({
      conversationId: input.conversation.id,
      senderId: AI_SYSTEM_USER_ID,
      text: ragResponse.answer,
      isAiGenerated: true,
    });
    const savedAnswer = await this.messageRepository.save(answerMessage);

    const now = new Date();
    await this.conversationRepository.update(input.conversation.id, {
      updatedAt: now,
    });

    // Re-read participants NOW (not at schedule time) so a revoke during
    // AI generation immediately stops delivery to the revoked user.
    const recipientIds = await this.resolveRecipientIds(input.conversation);

    const payload = {
      message: { ...savedAnswer, files: [] },
      conversation: {
        id: input.conversation.id,
        updatedAt: now,
      },
    };

    for (const recipientId of recipientIds) {
      this.wsGateway.emitToUser(recipientId, 'chat:new_message', payload);
    }

    this.logger.log(
      `AI reply delivered for conversation ${input.conversation.id} in ${
        Date.now() - startedAt
      }ms (refusalReason=${ragResponse.refusalReason ?? 'none'})`,
    );
  }

  private async resolveRecipientIds(
    conversation: ChatConversation,
  ): Promise<string[]> {
    if (conversation.type === ChatConversationType.Platform) {
      const participants = await this.participantRepository.find({
        where: { conversationId: conversation.id },
      });
      return participants
        .map((p) => p.userId)
        .filter((id) => id !== AI_SYSTEM_USER_ID);
    }
    return [
      conversation.participantOneId,
      conversation.participantTwoId,
    ].filter((id) => id !== AI_SYSTEM_USER_ID);
  }
}
