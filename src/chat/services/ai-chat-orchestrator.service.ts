import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ChatbotRagService } from '../../chatbot/services/chatbot-rag.service';
import { WebSocketGatewayService } from '../../websocket/websocket.gateway';
import { AI_SYSTEM_USER_ID } from '../chat.constants';
import { ChatConversation } from '../entities/chat-conversation.entity';
import { ChatMessage } from '../entities/chat-message.entity';
import { ChatHistoryMapperService } from './chat-history-mapper.service';

const HISTORY_FETCH_LIMIT = 40;

type RespondInput = {
  conversation: ChatConversation;
  clientUserId: string;
  clientMessageId: string;
  question: string;
  recipientIds: string[];
};

/**
 * Async orchestrator for the AI half of a platform conversation.
 *
 * `respondToClientMessage` is called from ChatService.sendMessage after the
 * client's own message has been persisted. It runs fire-and-forget:
 *
 *   1. Load the last N messages of the conversation (chronological).
 *   2. Map them to ChatbotHistoryEntry[] via ChatHistoryMapperService.
 *   3. Call ChatbotRagService.askQuestion({ question, history }).
 *   4. Persist the returned answer as a ChatMessage from AI_SYSTEM_USER_ID
 *      with isAiGenerated=true.
 *   5. Broadcast `chat:new_message` to every current recipient of the
 *      conversation (client + expert + operator, whoever's added).
 *
 * All failures are caught and logged — the caller (POST /chat/…) already
 * returned 200 to the client, so we must never re-throw. On RAG failure we
 * still write the fallback message from ChatbotRagService so the client
 * sees something instead of dead silence.
 */
@Injectable()
export class AiChatOrchestratorService {
  private readonly logger = new Logger(AiChatOrchestratorService.name);

  constructor(
    @InjectRepository(ChatMessage)
    private readonly messageRepository: Repository<ChatMessage>,
    @InjectRepository(ChatConversation)
    private readonly conversationRepository: Repository<ChatConversation>,
    private readonly ragService: ChatbotRagService,
    private readonly historyMapper: ChatHistoryMapperService,
    private readonly wsGateway: WebSocketGatewayService,
  ) {}

  scheduleReply(input: RespondInput): void {
    // Detach from the caller's request lifecycle. We never await the promise;
    // WS delivers the answer when it is ready.
    void this.respondToClientMessage(input).catch((error) => {
      this.logger.error(
        `AI chat orchestration crashed for conversation ${input.conversation.id}: ${
          error instanceof Error ? error.message : String(error)
        }`,
        error instanceof Error ? error.stack : undefined,
      );
    });
  }

  private async respondToClientMessage(input: RespondInput): Promise<void> {
    const startedAt = Date.now();

    const recentMessages = await this.messageRepository.find({
      where: { conversationId: input.conversation.id },
      order: { createdAt: 'DESC' },
      take: HISTORY_FETCH_LIMIT,
    });
    const chronological = [...recentMessages].reverse();
    // The current-turn message is already inside `input.question`. Drop it
    // (and only it) from `history` by id, not by position — a fast-typing
    // client can queue a second message before this task runs, in which case
    // slicing `.slice(0, -1)` would drop the wrong one and let the LLM see
    // its own question twice.
    const historySource = chronological.filter(
      (m) => m.id !== input.clientMessageId,
    );
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

    const payload = {
      message: { ...savedAnswer, files: [] },
      conversation: {
        id: input.conversation.id,
        updatedAt: now,
      },
    };

    for (const recipientId of input.recipientIds) {
      this.wsGateway.emitToUser(recipientId, 'chat:new_message', payload);
    }

    this.logger.log(
      `AI reply delivered for conversation ${input.conversation.id} in ${
        Date.now() - startedAt
      }ms (refusalReason=${ragResponse.refusalReason ?? 'none'})`,
    );
  }
}
