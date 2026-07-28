import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, QueryFailedError, Repository } from 'typeorm';
import { WebSocketGatewayService } from '../websocket/websocket.gateway';
import { FilesService } from '../files/files.service';
import { User } from '../users/entities/user.entity';
import { UserRole } from '../users/entities/user-role.enum';
import { Order } from '../orders/entities/order.entity';
import { ServiceType } from '../services/entities/service-type.enum';
import { ChatParticipantRole } from './entities/chat-participant-role.enum';
import { ChatConversationType } from './entities/chat-conversation-type.enum';
import { ChatConversationParticipant } from './entities/chat-conversation-participant.entity';
import { ChatMessage } from './entities/chat-message.entity';
import { ChatConversation } from './entities/chat-conversation.entity';
import { GetMessagesQueryDto } from './dto/get-messages-query.dto';
import { GetConversationsQueryDto } from './dto/get-conversations-query.dto';
import { SendMessageDto } from './dto/send-message.dto';
import { StartConversationDto } from './dto/start-conversation.dto';
import { AI_SYSTEM_USER_ID, AI_WELCOME_MESSAGE } from './chat.constants';
import { AiChatOrchestratorService } from './services/ai-chat-orchestrator.service';
import { SendPlatformMessageDto } from './dto/send-platform-message.dto';

@Injectable()
export class ChatService {
  constructor(
    @InjectRepository(ChatConversation)
    private readonly conversationRepository: Repository<ChatConversation>,
    @InjectRepository(ChatMessage)
    private readonly messageRepository: Repository<ChatMessage>,
    @InjectRepository(ChatConversationParticipant)
    private readonly participantRepository: Repository<ChatConversationParticipant>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(Order)
    private readonly orderRepository: Repository<Order>,
    private readonly wsGateway: WebSocketGatewayService,
    private readonly filesService: FilesService,
    private readonly aiOrchestrator: AiChatOrchestratorService,
    private readonly dataSource: DataSource,
  ) {}

  async getConversations(userId: string, query: GetConversationsQueryDto) {
    const { offset = 0, limit = 20 } = query;

    // Return conversations where user is a legacy participantOne/Two OR a
    // member of the participants table (needed for experts joined into a
    // client's platform chat after purchase).
    const qb = this.conversationRepository
      .createQueryBuilder('conv')
      .leftJoinAndSelect('conv.participantOne', 'p1')
      .leftJoinAndSelect('conv.participantTwo', 'p2')
      .where((sub) => {
        const memberSub = sub
          .subQuery()
          .select('1')
          .from(ChatConversationParticipant, 'part')
          .where('part."conversationId" = conv.id')
          .andWhere('part."userId" = :userId')
          .getQuery();
        return (
          '(conv."participantOneId" = :userId OR conv."participantTwoId" = :userId OR EXISTS ' +
          memberSub +
          ')'
        );
      })
      .setParameter('userId', userId)
      .orderBy('conv.updatedAt', 'DESC')
      .skip(offset)
      .take(limit);

    const [conversations, total] = await qb.getManyAndCount();

    const data = await Promise.all(
      conversations.map(async (conv) => {
        const otherUser = this.pickOtherParticipant(conv, userId);

        const lastMessage = await this.messageRepository.findOne({
          where: { conversationId: conv.id },
          order: { createdAt: 'DESC' },
        });

        const unreadCount = await this.computeUnreadCount(conv, userId);

        return {
          id: conv.id,
          type: conv.type,
          orderId: conv.orderId,
          participant: otherUser
            ? {
              id: otherUser.id,
              name: otherUser.name,
              lastName: otherUser.lastName,
              email: otherUser.email,
            }
            : null,
          lastMessage: lastMessage
            ? {
              id: lastMessage.id,
              text: lastMessage.text,
              senderId: lastMessage.senderId,
              isAiGenerated: lastMessage.isAiGenerated,
              createdAt: lastMessage.createdAt,
            }
            : null,
          unreadCount,
          updatedAt: conv.updatedAt,
        };
      }),
    );

    return { data, total, offset, limit };
  }

  async getMessages(
    userId: string,
    conversationId: string,
    query: GetMessagesQueryDto,
  ) {
    const { offset = 0, limit = 50 } = query;

    const conversation = await this.conversationRepository.findOne({
      where: { id: conversationId },
    });

    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }

    await this.assertConversationAccess(userId, conversation);

    const [messages, total] = await this.messageRepository.findAndCount({
      where: { conversationId },
      order: { createdAt: 'DESC' },
      skip: offset,
      take: limit,
    });

    const messageIds = messages.map((m) => m.id);
    const allFiles = await this.filesService.findByMessageIds(messageIds);
    const filesByMessageId = new Map<
      string,
      { id: string; name: string; size: number; type: string }[]
    >();
    for (const f of allFiles) {
      const arr = filesByMessageId.get(f.messageId!) ?? [];
      arr.push({
        id: f.id,
        name: f.originalName,
        size: f.size,
        type: f.mimeType,
      });
      filesByMessageId.set(f.messageId!, arr);
    }
    const messagesWithFiles = messages.map((m) => ({
      ...m,
      files: filesByMessageId.get(m.id) ?? [],
    }));

    // Mark the conversation as read for THIS participant. In platform chats
    // we track a per-participant `lastReadAt` cursor because 3+ people share
    // the same messages and a global `isRead` flag would zero out unread
    // counts for everyone else once the first participant reads. Legacy
    // expert chats stay on the message-level flag (only two participants).
    //
    // Anchor the cursor to the newest LOADED message's timestamp (not NOW)
    // so a message inserted between the load and this update stays unread
    // — otherwise the client would never see it in their unread counter.
    const readCursor = messages.length > 0 ? messages[0].createdAt : null;
    await this.markConversationRead(userId, conversation, readCursor);

    // WS: notify other participants that we read their messages.
    const otherRecipients = await this.getRecipientIds(conversation, userId);
    for (const recipient of otherRecipients) {
      this.wsGateway.emitToUser(recipient, 'chat:messages_read', {
        conversationId,
        readBy: userId,
      });
    }

    return { data: messagesWithFiles, total, offset, limit };
  }

  async sendMessage(userId: string, dto: SendMessageDto) {
    if (userId === dto.recipientId) {
      throw new BadRequestException('Cannot send a message to yourself');
    }
    if (dto.recipientId === AI_SYSTEM_USER_ID) {
      throw new BadRequestException(
        'Use POST /chat/conversations/platform to open the AI-консультант chat, ' +
          'then POST /chat/conversations/:id/messages to send messages there.',
      );
    }

    const recipient = await this.requireUserById(
      dto.recipientId,
      'Recipient not found',
    );

    const [participantOneId, participantTwoId] =
      userId < dto.recipientId
        ? [userId, dto.recipientId]
        : [dto.recipientId, userId];
    const normalizedOrderId = dto.orderId ?? null;

    let conversation = await this.conversationRepository.findOne({
      where: {
        participantOneId,
        participantTwoId,
        orderId: normalizedOrderId ?? IsNull(),
      },
    });

    if (!conversation) {
      await this.assertCanUseChatContext(userId, recipient, normalizedOrderId);
      conversation = this.conversationRepository.create({
        participantOneId,
        participantTwoId,
        orderId: normalizedOrderId,
        type: ChatConversationType.Expert,
      });
      conversation = await this.conversationRepository.save(conversation);
      const [oneUser, twoUser] =
        participantOneId === userId
          ? [await this.requireUserById(userId, 'Sender not found'), recipient]
          : [recipient, await this.requireUserById(userId, 'Sender not found')];
      await this.ensureParticipant(
        conversation.id,
        participantOneId,
        this.mapUserRoleToParticipantRole(oneUser.role),
      );
      await this.ensureParticipant(
        conversation.id,
        participantTwoId,
        this.mapUserRoleToParticipantRole(twoUser.role),
      );
    } else {
      await this.assertConversationAccess(userId, conversation);
    }

    const savedMessage = await this.persistMessage({
      conversationId: conversation.id,
      senderId: userId,
      text: dto.text,
    });

    const files = await this.linkFilesToMessage(dto.fileIds, savedMessage.id);
    await this.conversationRepository.update(conversation.id, {
      updatedAt: new Date(),
    });

    const payload = {
      message: { ...savedMessage, files },
      conversation: {
        id: conversation.id,
        updatedAt: new Date(),
      },
    };

    this.wsGateway.emitToUser(userId, 'chat:new_message', payload);
    this.wsGateway.emitToUser(dto.recipientId, 'chat:new_message', payload);

    return { ...savedMessage, files };
  }

  /**
   * Open (or return the existing) platform conversation for the given client.
   * On first creation seeds a welcome message authored by the AI so the client
   * never sees an empty chat window.
   *
   * Returns the same shape as {@link findOrCreateConversation} so the
   * frontend can consume both endpoints uniformly.
   */
  async openPlatformConversation(userId: string) {
    const user = await this.requireUserById(userId, 'User not found');
    if (user.role !== UserRole.USER) {
      throw new ForbiddenException(
        'Platform chat is only available for client accounts',
      );
    }

    const conversation = await this.findOrCreatePlatformConversation(userId);
    const aiUser = await this.userRepository.findOne({
      where: { id: AI_SYSTEM_USER_ID },
    });
    const lastMessage = await this.messageRepository.findOne({
      where: { conversationId: conversation.id },
      order: { createdAt: 'DESC' },
    });
    const unreadCount = await this.computeUnreadCount(conversation, userId);

    return {
      id: conversation.id,
      type: conversation.type,
      participant: aiUser
        ? {
          id: aiUser.id,
          name: aiUser.name,
          lastName: aiUser.lastName,
          email: aiUser.email,
        }
        : null,
      lastMessage: lastMessage
        ? {
          id: lastMessage.id,
          text: lastMessage.text,
          senderId: lastMessage.senderId,
          isAiGenerated: lastMessage.isAiGenerated,
          createdAt: lastMessage.createdAt,
        }
        : null,
      unreadCount,
      orderId: conversation.orderId,
      updatedAt: conversation.updatedAt,
    };
  }

  /**
   * Idempotent primitive that opens the client's single platform-type
   * conversation. Safe to call from `openPlatformConversation` (endpoint) and
   * from `addExpertToClientPlatformChat` (orders hook) without the caller
   * having to worry about roles or ordering.
   *
   * Race handling: two parallel requests can race past the `findOne` check.
   * We catch the resulting unique-constraint violation (participantOneId,
   * participantTwoId, orderId) and re-read the row the other request wrote,
   * so both callers converge on the same conversation.
   */
  private async findOrCreatePlatformConversation(
    clientUserId: string,
  ): Promise<ChatConversation> {
    const [participantOneId, participantTwoId] =
      AI_SYSTEM_USER_ID < clientUserId
        ? [AI_SYSTEM_USER_ID, clientUserId]
        : [clientUserId, AI_SYSTEM_USER_ID];

    const existing = await this.conversationRepository.findOne({
      where: {
        participantOneId,
        participantTwoId,
        orderId: IsNull(),
        type: ChatConversationType.Platform,
      },
    });
    if (existing) {
      return existing;
    }

    try {
      return await this.dataSource.transaction(async (manager) => {
        const conv = manager.getRepository(ChatConversation).create({
          participantOneId,
          participantTwoId,
          orderId: null,
          type: ChatConversationType.Platform,
        });
        const savedConv = await manager
          .getRepository(ChatConversation)
          .save(conv);

        await manager.getRepository(ChatConversationParticipant).save([
          manager.getRepository(ChatConversationParticipant).create({
            conversationId: savedConv.id,
            userId: clientUserId,
            role: ChatParticipantRole.Client,
          }),
          manager.getRepository(ChatConversationParticipant).create({
            conversationId: savedConv.id,
            userId: AI_SYSTEM_USER_ID,
            role: ChatParticipantRole.Ai,
          }),
        ]);

        await manager.getRepository(ChatMessage).save(
          manager.getRepository(ChatMessage).create({
            conversationId: savedConv.id,
            senderId: AI_SYSTEM_USER_ID,
            text: AI_WELCOME_MESSAGE,
            isAiGenerated: true,
          }),
        );

        return savedConv;
      });
    } catch (error) {
      // 23505 = unique_violation. Another concurrent request created the same
      // (participantOneId, participantTwoId, orderId) row a beat before us.
      if (
        error instanceof QueryFailedError &&
        (error as QueryFailedError & { code?: string }).code === '23505'
      ) {
        const raced = await this.conversationRepository.findOne({
          where: {
            participantOneId,
            participantTwoId,
            orderId: IsNull(),
            type: ChatConversationType.Platform,
          },
        });
        if (raced) return raced;
      }
      throw error;
    }
  }

  /**
   * Send a message inside a platform conversation.
   *
   * When the client sends → we persist the message and schedule an async AI
   * reply through AiChatOrchestratorService. When an expert or operator (a
   * joined participant) sends → we persist and broadcast, but do NOT trigger
   * the AI: the human is answering directly. Non-participants get 403.
   */
  async sendPlatformMessage(
    userId: string,
    conversationId: string,
    dto: SendPlatformMessageDto,
  ) {
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

    const savedMessage = await this.persistMessage({
      conversationId: conversation.id,
      senderId: userId,
      text: dto.text,
    });
    const files = await this.linkFilesToMessage(dto.fileIds, savedMessage.id);
    const now = new Date();
    await this.conversationRepository.update(conversation.id, {
      updatedAt: now,
    });

    const recipientIds = await this.getRecipientIds(conversation, userId);
    const payload = {
      message: { ...savedMessage, files },
      conversation: { id: conversation.id, updatedAt: now },
    };
    this.wsGateway.emitToUser(userId, 'chat:new_message', payload);
    for (const recipientId of recipientIds) {
      this.wsGateway.emitToUser(recipientId, 'chat:new_message', payload);
    }

    if (membership.role === ChatParticipantRole.Client) {
      // Only client turns trigger an AI reply. Expert / operator turns are
      // human-authored answers to the client and must not spawn an AI echo.
      // Orchestrator re-reads participants at emit time so a revoke during
      // AI generation stops delivery to the revoked user.
      this.aiOrchestrator.scheduleReply({
        conversation,
        clientUserId: userId,
        clientMessageId: savedMessage.id,
        question: dto.text,
      });
    }

    return { ...savedMessage, files };
  }

  /**
   * Add an expert as a participant of the given client's platform conversation.
   *
   * Called by OrdersService when contractorChatAccess is granted. If the
   * client has no platform conversation yet (opened lazily), we create it —
   * so the expert always gets a chat to work with regardless of when the
   * client first opens the widget.
   */
  async addExpertToClientPlatformChat(
    clientUserId: string,
    expertUserId: string,
  ): Promise<void> {
    // Skip the client-role check that openPlatformConversation enforces —
    // this call originates from the admin flow (contractorChatAccess=true)
    // and just needs the conversation to exist so the expert can be added.
    const conversation =
      await this.findOrCreatePlatformConversation(clientUserId);
    await this.ensureParticipant(
      conversation.id,
      expertUserId,
      ChatParticipantRole.Expert,
    );
  }

  /**
   * Remove an expert from the given client's platform conversation.
   *
   * Called by OrdersService when contractorChatAccess is revoked (and no
   * other active grant keeps the expert entitled). Idempotent: if the client
   * has no platform conversation yet, or the expert was never a participant,
   * this is a no-op — nothing to detach.
   */
  async removeExpertFromClientPlatformChat(
    clientUserId: string,
    expertUserId: string,
  ): Promise<void> {
    const [participantOneId, participantTwoId] =
      AI_SYSTEM_USER_ID < clientUserId
        ? [AI_SYSTEM_USER_ID, clientUserId]
        : [clientUserId, AI_SYSTEM_USER_ID];

    const conversation = await this.conversationRepository.findOne({
      where: {
        participantOneId,
        participantTwoId,
        orderId: IsNull(),
        type: ChatConversationType.Platform,
      },
    });
    if (!conversation) {
      return;
    }

    await this.participantRepository.delete({
      conversationId: conversation.id,
      userId: expertUserId,
      role: ChatParticipantRole.Expert,
    });
  }

  async markAsRead(userId: string, conversationId: string) {
    const conversation = await this.conversationRepository.findOne({
      where: { id: conversationId },
    });

    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }

    await this.assertConversationAccess(userId, conversation);

    await this.markConversationRead(userId, conversation);

    const recipients = await this.getRecipientIds(conversation, userId);
    for (const recipient of recipients) {
      this.wsGateway.emitToUser(recipient, 'chat:messages_read', {
        conversationId,
        readBy: userId,
      });
    }

    return { success: true };
  }

  async findOrCreateConversation(userId: string, dto: StartConversationDto) {
    if (userId === dto.recipientId) {
      throw new BadRequestException(
        'Cannot start a conversation with yourself',
      );
    }
    if (dto.recipientId === AI_SYSTEM_USER_ID) {
      throw new BadRequestException(
        'Use POST /chat/conversations/platform to open the AI-консультант chat.',
      );
    }

    const recipient = await this.requireUserById(
      dto.recipientId,
      'Recipient not found',
    );
    const normalizedOrderId = dto.orderId ?? null;
    await this.assertCanUseChatContext(userId, recipient, normalizedOrderId);

    const [participantOneId, participantTwoId] =
      userId < dto.recipientId
        ? [userId, dto.recipientId]
        : [dto.recipientId, userId];

    let conversation = await this.conversationRepository.findOne({
      where: {
        participantOneId,
        participantTwoId,
        orderId: normalizedOrderId ?? IsNull(),
      },
    });

    if (!conversation) {
      conversation = this.conversationRepository.create({
        participantOneId,
        participantTwoId,
        orderId: normalizedOrderId,
        type: ChatConversationType.Expert,
      });
      conversation = await this.conversationRepository.save(conversation);
      const [oneUser, twoUser] =
        participantOneId === userId
          ? [await this.requireUserById(userId, 'Sender not found'), recipient]
          : [recipient, await this.requireUserById(userId, 'Sender not found')];
      await this.ensureParticipant(
        conversation.id,
        participantOneId,
        this.mapUserRoleToParticipantRole(oneUser.role),
      );
      await this.ensureParticipant(
        conversation.id,
        participantTwoId,
        this.mapUserRoleToParticipantRole(twoUser.role),
      );
    }

    return {
      id: conversation.id,
      type: conversation.type,
      participant: {
        id: recipient.id,
        name: recipient.name,
        lastName: recipient.lastName,
        email: recipient.email,
      },
      lastMessage: null,
      unreadCount: 0,
      orderId: conversation.orderId,
      updatedAt: conversation.updatedAt,
    };
  }

  // ── private helpers ───────────────────────────────────────────────

  private async persistMessage(input: {
    conversationId: string;
    senderId: string;
    text: string;
  }): Promise<ChatMessage> {
    const message = this.messageRepository.create({
      conversationId: input.conversationId,
      senderId: input.senderId,
      text: input.text,
    });
    return this.messageRepository.save(message);
  }

  private async linkFilesToMessage(
    fileIds: string[] | undefined,
    messageId: string,
  ) {
    if (!fileIds?.length) return [];
    await this.filesService.linkToMessage(fileIds, messageId);
    const fileEntities = await this.filesService.findByIds(fileIds);
    return fileEntities.map((f) => ({
      id: f.id,
      name: f.originalName,
      size: f.size,
      type: f.mimeType,
    }));
  }

  private async ensureParticipant(
    conversationId: string,
    userId: string,
    role: ChatParticipantRole,
  ): Promise<void> {
    const existing = await this.participantRepository.findOne({
      where: { conversationId, userId },
    });
    if (existing) return;
    const participant = this.participantRepository.create({
      conversationId,
      userId,
      role,
    });
    await this.participantRepository.save(participant);
  }

  private mapUserRoleToParticipantRole(role: UserRole): ChatParticipantRole {
    switch (role) {
      case UserRole.EXPERT:
        return ChatParticipantRole.Expert;
      case UserRole.ADMIN:
        return ChatParticipantRole.Operator;
      case UserRole.SYSTEM_AI:
        return ChatParticipantRole.Ai;
      default:
        return ChatParticipantRole.Client;
    }
  }

  private pickOtherParticipant(
    conversation: ChatConversation,
    userId: string,
  ): User | null {
    if (conversation.participantOneId === userId) {
      return conversation.participantTwo ?? null;
    }
    if (conversation.participantTwoId === userId) {
      return conversation.participantOne ?? null;
    }
    // User is a member (e.g. expert joined), pick the client side.
    return conversation.participantTwo ?? conversation.participantOne ?? null;
  }

  private async markConversationRead(
    userId: string,
    conversation: ChatConversation,
    cursor?: Date | null,
  ): Promise<void> {
    if (conversation.type === ChatConversationType.Platform) {
      // Cursor defaults to the newest existing message's timestamp — resolved
      // here so callers like markAsRead don't need to fetch it themselves.
      // Using createdAt of an actual message (not NOW()) makes the read
      // marker race-free: a message inserted after our fetch has a strictly
      // greater createdAt and stays unread until the next read pass.
      let effectiveCursor = cursor ?? null;
      if (!effectiveCursor) {
        const latest = await this.messageRepository.findOne({
          where: { conversationId: conversation.id },
          order: { createdAt: 'DESC' },
        });
        effectiveCursor = latest?.createdAt ?? null;
      }
      if (!effectiveCursor) return;
      // `lastReadAt` must be monotonic — paging BACK (older messages) would
      // otherwise rewind the cursor to an older timestamp and resurrect
      // already-read messages as unread. GREATEST(current, new) keeps the
      // marker moving strictly forward.
      await this.participantRepository
        .createQueryBuilder()
        .update(ChatConversationParticipant)
        .set({
          lastReadAt: () => 'GREATEST(COALESCE("lastReadAt", :cursor), :cursor)',
        })
        .where('"conversationId" = :conversationId', {
          conversationId: conversation.id,
        })
        .andWhere('"userId" = :userId', { userId })
        .setParameter('cursor', effectiveCursor)
        .execute();
      return;
    }
    await this.messageRepository
      .createQueryBuilder()
      .update(ChatMessage)
      .set({ isRead: true })
      .where('conversationId = :conversationId', {
        conversationId: conversation.id,
      })
      .andWhere('senderId != :userId', { userId })
      .andWhere('isRead = false')
      .execute();
  }

  private async computeUnreadCount(
    conversation: ChatConversation,
    userId: string,
  ): Promise<number> {
    if (conversation.type === ChatConversationType.Platform) {
      const participant = await this.participantRepository.findOne({
        where: { conversationId: conversation.id, userId },
      });
      const qb = this.messageRepository
        .createQueryBuilder('m')
        .where('m."conversationId" = :conversationId', {
          conversationId: conversation.id,
        })
        .andWhere('m."senderId" != :userId', { userId });
      if (participant?.lastReadAt) {
        qb.andWhere('m."createdAt" > :lastReadAt', {
          lastReadAt: participant.lastReadAt,
        });
      }
      return qb.getCount();
    }
    return this.messageRepository
      .createQueryBuilder('m')
      .where('m."conversationId" = :conversationId', {
        conversationId: conversation.id,
      })
      .andWhere('m."isRead" = false')
      .andWhere('m."senderId" != :userId', { userId })
      .getCount();
  }

  private async getRecipientIds(
    conversation: ChatConversation,
    excludeUserId: string,
  ): Promise<string[]> {
    if (conversation.type === ChatConversationType.Platform) {
      const participants = await this.participantRepository.find({
        where: { conversationId: conversation.id },
      });
      return participants
        .map((p) => p.userId)
        .filter((id) => id !== excludeUserId && id !== AI_SYSTEM_USER_ID);
    }
    // Expert-type: legacy two-participant layout.
    return conversation.participantOneId === excludeUserId
      ? [conversation.participantTwoId]
      : [conversation.participantOneId];
  }

  private async assertConversationAccess(
    userId: string,
    conversation: ChatConversation,
  ): Promise<void> {
    if (conversation.type === ChatConversationType.Platform) {
      // Platform chats are private between the client, their AI-consultant
      // and (optionally) a purchased expert / joined operator. Admins do NOT
      // get a global back-door here — per QIR-256 spec section 8, admin
      // visibility of other clients' platform chats is explicitly out of
      // scope. Access is granted only via the participants table.
      const membership = await this.participantRepository.findOne({
        where: { conversationId: conversation.id, userId },
      });
      if (!membership) {
        throw new ForbiddenException(
          'You are not a participant of this conversation',
        );
      }
      return;
    }

    // Legacy expert-type conversations: admins have full visibility (existing
    // behaviour) — used for support / moderation of expert-client threads.
    const user = await this.requireUserById(userId, 'User not found');
    if (user.role === UserRole.ADMIN) {
      return;
    }

    if (
      conversation.participantOneId !== userId &&
      conversation.participantTwoId !== userId
    ) {
      throw new ForbiddenException(
        'You are not a participant of this conversation',
      );
    }

    if (!conversation.orderId) {
      return;
    }

    const hasOrderAccess = await this.canParticipantsUseOrderChat(
      conversation.orderId,
      conversation.participantOneId,
      conversation.participantTwoId,
    );

    if (!hasOrderAccess) {
      throw new ForbiddenException(
        'Chat access for this order is not granted or order participants do not match',
      );
    }
  }

  private async assertCanUseChatContext(
    senderId: string,
    recipient: User,
    orderId: string | null,
  ): Promise<void> {
    const sender = await this.requireUserById(senderId, 'Sender not found');
    if (sender.role === UserRole.ADMIN) {
      return;
    }

    if (!orderId) {
      const hasExpertParticipant =
        sender.role === UserRole.EXPERT || recipient.role === UserRole.EXPERT;
      if (hasExpertParticipant) {
        throw new ForbiddenException(
          'Expert-client chat must be started with orderId and granted contractor chat access',
        );
      }
      return;
    }

    const hasOrderAccess = await this.canParticipantsUseOrderChat(
      orderId,
      senderId,
      recipient.id,
    );

    if (!hasOrderAccess) {
      throw new ForbiddenException(
        'Chat access for this order is not granted or order participants do not match',
      );
    }
  }

  private async canParticipantsUseOrderChat(
    orderId: string,
    firstParticipantId: string,
    secondParticipantId: string,
  ): Promise<boolean> {
    const order = await this.orderRepository.findOne({
      where: { id: orderId },
      select: ['id', 'userId', 'contractorChatAccess'],
    });

    if (!order || !order.contractorChatAccess) {
      return false;
    }

    const participantIds = new Set([firstParticipantId, secondParticipantId]);
    if (!participantIds.has(order.userId)) {
      return false;
    }

    const expertParticipantId =
      order.userId === firstParticipantId
        ? secondParticipantId
        : order.userId === secondParticipantId
          ? firstParticipantId
          : null;

    if (!expertParticipantId || expertParticipantId === order.userId) {
      return false;
    }

    const matchedLegacyContractor = await this.orderRepository
      .createQueryBuilder('o')
      .innerJoin('o.item', 'item')
      .innerJoin('item.service', 'service')
      .where('o.id = :orderId', { orderId })
      .andWhere('service.type = :contractorType', {
        contractorType: ServiceType.Contractor,
      })
      .andWhere('service."userId" = :expertParticipantId', {
        expertParticipantId,
      })
      .select('service.id', 'id')
      .getRawOne<{ id: string }>();

    if (matchedLegacyContractor) {
      return true;
    }

    const matchedPositionExecutor = await this.orderRepository
      .createQueryBuilder('o')
      .innerJoin('o.item', 'item')
      .where('o.id = :orderId', { orderId })
      .andWhere('item."executorUserId" = :expertParticipantId', {
        expertParticipantId,
      })
      .select('item.id', 'id')
      .getRawOne<{ id: string }>();

    return Boolean(matchedPositionExecutor);
  }

  private async requireUserById(
    userId: string,
    message: string,
  ): Promise<User> {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException(message);
    }
    return user;
  }
}
