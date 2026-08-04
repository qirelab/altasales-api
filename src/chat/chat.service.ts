import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, Repository } from 'typeorm';
import { WebSocketGatewayService } from '../websocket/websocket.gateway';
import { FilesService } from '../files/files.service';
import { User } from '../users/entities/user.entity';
import { UserRole } from '../users/entities/user-role.enum';
import { Order } from '../orders/entities/order.entity';
import { ServiceType } from '../services/entities/service-type.enum';
import { ChatParticipantRole } from './entities/chat-participant-role.enum';
import { ChatSessionType } from './entities/chat-session-type.enum';
import { ChatHandoffStatus } from './entities/chat-handoff-status.enum';
import { ChatSessionParticipant } from './entities/chat-session-participant.entity';
import { ChatMessage } from './entities/chat-message.entity';
import { ChatSession } from './entities/chat-session.entity';
import { GetMessagesQueryDto } from './dto/get-messages-query.dto';
import { GetSessionsQueryDto } from './dto/get-sessions-query.dto';
import { SendMessageDto } from './dto/send-message.dto';
import { StartSessionDto } from './dto/start-session.dto';
import { AI_SYSTEM_USER_ID } from './chat.constants';
import { AiChatOrchestratorService } from './services/ai-chat-orchestrator.service';
import { SendPlatformMessageDto } from './dto/send-platform-message.dto';
import { SessionTitleService } from './services/session-title.service';

@Injectable()
export class ChatService {
  constructor(
    @InjectRepository(ChatSession)
    private readonly conversationRepository: Repository<ChatSession>,
    @InjectRepository(ChatMessage)
    private readonly messageRepository: Repository<ChatMessage>,
    @InjectRepository(ChatSessionParticipant)
    private readonly participantRepository: Repository<ChatSessionParticipant>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(Order)
    private readonly orderRepository: Repository<Order>,
    private readonly wsGateway: WebSocketGatewayService,
    private readonly filesService: FilesService,
    private readonly aiOrchestrator: AiChatOrchestratorService,
    private readonly sessionTitleService: SessionTitleService,
    private readonly dataSource: DataSource,
  ) {}

  async getSessions(userId: string, query: GetSessionsQueryDto) {
    const { offset = 0, limit = 20 } = query;

    // Return conversations where user is a legacy participantOne/Two OR a
    // member of the participants table (needed for experts joined into a
    // client's platform chat after purchase).
    const qb = this.conversationRepository
      .createQueryBuilder('conv')
      .leftJoinAndSelect('conv.participantOne', 'p1')
      .leftJoinAndSelect('conv.participantTwo', 'p2')
      .leftJoinAndSelect('conv.assignedOperator', 'op')
      .where((sub) => {
        const memberSub = sub
          .subQuery()
          .select('1')
          .from(ChatSessionParticipant, 'part')
          .where('part."sessionId" = conv.id')
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
          where: { sessionId: conv.id },
          order: { createdAt: 'DESC' },
        });

        const unreadCount = await this.computeUnreadCount(conv, userId);

        const participant = pickParticipant(otherUser);
        const lastMessagePreview = pickLastMessagePreview(lastMessage);
        return {
          id: conv.id,
          type: conv.type,
          title: conv.title,
          orderId: conv.orderId,
          participant,
          lastMessage: lastMessagePreview,
          unreadCount,
          updatedAt: conv.updatedAt,
          needsHumanHandoff: conv.needsHumanHandoff,
          handoffTrigger: conv.handoffTrigger,
          handoffRequestedAt: conv.handoffRequestedAt,
          handoffStatus: conv.handoffStatus,
          handoffClaimedAt: conv.handoffClaimedAt,
          handoffResolvedAt: conv.handoffResolvedAt,
          assignedOperatorId: conv.assignedOperatorId,
          assignedOperator: pickParticipant(conv.assignedOperator),
        };
      }),
    );

    return { data, total, offset, limit };
  }

  async getMessages(
    userId: string,
    sessionId: string,
    query: GetMessagesQueryDto,
  ) {
    const { offset = 0, limit = 50 } = query;

    const conversation = await this.conversationRepository.findOne({
      where: { id: sessionId },
    });

    if (!conversation) {
      throw new NotFoundException('Session not found');
    }

    await this.assertConversationAccess(userId, conversation);

    const [messages, total] = await this.messageRepository.findAndCount({
      where: { sessionId },
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
        sessionId,
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
        'Use POST /chat/sessions/platform to open the AI-консультант chat, ' +
          'then POST /chat/sessions/:id/messages to send messages there.',
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
        type: ChatSessionType.Expert,
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
      sessionId: conversation.id,
      senderId: userId,
      text: dto.text,
    });

    const files = await this.linkFilesToMessage(dto.fileIds, savedMessage.id);
    await this.conversationRepository.update(conversation.id, {
      updatedAt: new Date(),
    });

    const payload = {
      message: { ...savedMessage, files },
      session: {
        id: conversation.id,
        updatedAt: new Date(),
        title: conversation.title,
      },
    };

    this.wsGateway.emitToUser(userId, 'chat:new_message', payload);
    this.wsGateway.emitToUser(dto.recipientId, 'chat:new_message', payload);

    return { ...savedMessage, files };
  }

  /**
   * Create a new platform (AI) session for the given client.
   *
   * Always creates a new session — clients can have any number of platform
   * sessions to keep different conversation topics separate. On creation
   * client + AI + all currently-active experts of this client join as
   * participants, so a purchased expert stays reachable across every new
   * session the client starts. No welcome message is seeded: the first
   * visible turn is the client's own message, and the AI reply follows via
   * the orchestrator.
   */
  async openPlatformSession(userId: string) {
    const user = await this.requireUserById(userId, 'User not found');
    if (user.role !== UserRole.USER) {
      throw new ForbiddenException(
        'Platform chat is only available for client accounts',
      );
    }

    const session = await this.createPlatformSession(userId);
    const aiUser = await this.userRepository.findOne({
      where: { id: AI_SYSTEM_USER_ID },
    });
    const lastMessage = await this.messageRepository.findOne({
      where: { sessionId: session.id },
      order: { createdAt: 'DESC' },
    });
    const unreadCount = await this.computeUnreadCount(session, userId);

    const participant = pickParticipant(aiUser);
    const lastMessagePreview = pickLastMessagePreview(lastMessage);
    return {
      id: session.id,
      type: session.type,
      title: session.title,
      participant,
      lastMessage: lastMessagePreview,
      unreadCount,
      orderId: session.orderId,
      updatedAt: session.updatedAt,
      needsHumanHandoff: session.needsHumanHandoff,
      handoffTrigger: session.handoffTrigger,
      handoffRequestedAt: session.handoffRequestedAt,
      handoffStatus: session.handoffStatus,
      assignedOperatorId: session.assignedOperatorId,
    };
  }

  /**
   * Physically create a new platform-type ChatSession for a client. Called by
   * `openPlatformSession` (endpoint) and `addExpertToClientPlatformSessions`
   * (orders hook when the client has no sessions yet).
   */
  private async createPlatformSession(
    clientUserId: string,
  ): Promise<ChatSession> {
    const [participantOneId, participantTwoId] =
      AI_SYSTEM_USER_ID < clientUserId
        ? [AI_SYSTEM_USER_ID, clientUserId]
        : [clientUserId, AI_SYSTEM_USER_ID];

    const activeExpertIds = await this.getClientActiveExpertIds(clientUserId);

    return await this.dataSource.transaction(async (manager) => {
      const session = manager.getRepository(ChatSession).create({
        participantOneId,
        participantTwoId,
        orderId: null,
        type: ChatSessionType.Platform,
        title: null,
      });
      const savedSession = await manager
        .getRepository(ChatSession)
        .save(session);

      const participants = [
        manager.getRepository(ChatSessionParticipant).create({
          sessionId: savedSession.id,
          userId: clientUserId,
          role: ChatParticipantRole.Client,
        }),
        manager.getRepository(ChatSessionParticipant).create({
          sessionId: savedSession.id,
          userId: AI_SYSTEM_USER_ID,
          role: ChatParticipantRole.Ai,
        }),
        ...activeExpertIds.map((expertId) =>
          manager.getRepository(ChatSessionParticipant).create({
            sessionId: savedSession.id,
            userId: expertId,
            role: ChatParticipantRole.Expert,
          }),
        ),
      ];
      await manager.getRepository(ChatSessionParticipant).save(participants);

      return savedSession;
    });
  }

  /**
   * All existing platform sessions of the given client. Used both to sync
   * expert access across sessions and to compute the set of active experts
   * when a new session is created.
   */
  private async getClientPlatformSessions(
    clientUserId: string,
  ): Promise<ChatSession[]> {
    const [participantOneId, participantTwoId] =
      AI_SYSTEM_USER_ID < clientUserId
        ? [AI_SYSTEM_USER_ID, clientUserId]
        : [clientUserId, AI_SYSTEM_USER_ID];
    return this.conversationRepository.find({
      where: {
        participantOneId,
        participantTwoId,
        orderId: IsNull(),
        type: ChatSessionType.Platform,
      },
    });
  }

  /**
   * Distinct expert user IDs currently participating in ANY of the client's
   * platform sessions. New sessions auto-join every listed expert so a
   * purchased expert never has to be re-added session-by-session.
   */
  private async getClientActiveExpertIds(
    clientUserId: string,
  ): Promise<string[]> {
    const rows = await this.participantRepository
      .createQueryBuilder('p')
      .innerJoin(ChatSession, 's', 's.id = p."sessionId"')
      .where('s.type = :type', { type: ChatSessionType.Platform })
      .andWhere(
        '(s."participantOneId" = :clientId OR s."participantTwoId" = :clientId)',
        { clientId: clientUserId },
      )
      .andWhere('p.role = :role', { role: ChatParticipantRole.Expert })
      .select('DISTINCT p."userId"', 'userId')
      .getRawMany<{ userId: string }>();
    return rows.map((r) => r.userId);
  }

  /**
   * Send a message inside a platform conversation.
   *
   * When the client sends → we persist the message and schedule an async AI
   * reply through AiChatOrchestratorService (unless a handoff is awaiting /
   * in_progress — AI stays paused until AdminChatService.resolve).
   * When an expert or operator sends → we persist and broadcast only; handoff
   * stays open until the operator explicitly resolves. Non-participants get 403.
   */
  async sendPlatformMessage(
    userId: string,
    sessionId: string,
    dto: SendPlatformMessageDto,
  ) {
    const conversation = await this.conversationRepository.findOne({
      where: { id: sessionId },
    });
    if (!conversation) {
      throw new NotFoundException('Session not found');
    }
    if (conversation.type !== ChatSessionType.Platform) {
      throw new BadRequestException(
        'This endpoint accepts only platform-type conversations',
      );
    }

    const membership = await this.participantRepository.findOne({
      where: { sessionId: conversation.id, userId },
    });
    if (!membership) {
      throw new ForbiddenException(
        'You are not a participant of this conversation',
      );
    }

    const savedMessage = await this.persistMessage({
      sessionId: conversation.id,
      senderId: userId,
      text: dto.text,
    });
    const files = await this.linkFilesToMessage(dto.fileIds, savedMessage.id);
    const now = new Date();

    await this.conversationRepository.update(conversation.id, { updatedAt: now });

    // Fire-and-forget AI-generated session title on the client's first
    // message. Doesn't block the reply pipeline — the sidebar picks up
    // the new title via the `chat:session_updated` WS event.
    if (
      membership.role === ChatParticipantRole.Client
      && !conversation.title
    ) {
      void this.sessionTitleService.generateAndAssign(conversation.id, dto.text);
    }

    // Handoff lifecycle ends only via AdminChatService.resolve (claim →
    // human replies → explicit resolve + AI "back online" announce).
    // Do NOT auto-resolve on the first operator/expert message — that
    // dropped chats from the operator inbox mid-conversation and skipped
    // the resolve announcement the client needs.

    const recipientIds = await this.getRecipientIds(conversation, userId);
    const payload = {
      message: { ...savedMessage, files },
      session: {
        id: conversation.id,
        updatedAt: now,
        title: conversation.title,
      },
    };
    this.wsGateway.emitToUser(userId, 'chat:new_message', payload);
    for (const recipientId of recipientIds) {
      this.wsGateway.emitToUser(recipientId, 'chat:new_message', payload);
    }

    const aiPaused =
      conversation.handoffStatus === ChatHandoffStatus.Awaiting
      || conversation.handoffStatus === ChatHandoffStatus.InProgress;
    if (membership.role === ChatParticipantRole.Client && !aiPaused) {
      // Only client turns trigger an AI reply. Expert / operator turns are
      // human-authored answers to the client and must not spawn an AI echo.
      // Skip AI while operator handoff owns the thread.
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
   * Add an expert as a participant of ALL of the client's existing platform
   * sessions.
   *
   * Called by OrdersService when contractorChatAccess is granted. Multi-session
   * means the expert needs to see every current topic the client has open;
   * future sessions the client creates will auto-include this expert via
   * {@link getClientActiveExpertIds}.
   */
  async addExpertToClientPlatformSessions(
    clientUserId: string,
    expertUserId: string,
  ): Promise<void> {
    const sessions = await this.getClientPlatformSessions(clientUserId);
    if (sessions.length === 0) {
      // Client has not opened any platform session yet. Create the initial
      // one so the expert has somewhere to be — future sessions will then
      // auto-include this expert via getClientActiveExpertIds. This mirrors
      // the pre-multi-session behavior where addExpertToClientPlatformChat
      // would find-or-create.
      const created = await this.createPlatformSession(clientUserId);
      await this.ensureParticipant(
        created.id,
        expertUserId,
        ChatParticipantRole.Expert,
      );
      return;
    }
    for (const session of sessions) {
      await this.ensureParticipant(
        session.id,
        expertUserId,
        ChatParticipantRole.Expert,
      );
    }
  }

  /**
   * Remove an expert from ALL of the client's platform sessions.
   *
   * Called by OrdersService when contractorChatAccess is revoked (and no
   * other active grant keeps the expert entitled). Idempotent: silently
   * detaches from every session where the expert is present.
   */
  async removeExpertFromClientPlatformSessions(
    clientUserId: string,
    expertUserId: string,
  ): Promise<void> {
    const sessions = await this.getClientPlatformSessions(clientUserId);
    for (const session of sessions) {
      await this.participantRepository.delete({
        sessionId: session.id,
        userId: expertUserId,
        role: ChatParticipantRole.Expert,
      });
    }
  }

  async markAsRead(userId: string, sessionId: string) {
    const conversation = await this.conversationRepository.findOne({
      where: { id: sessionId },
    });

    if (!conversation) {
      throw new NotFoundException('Session not found');
    }

    await this.assertConversationAccess(userId, conversation);

    await this.markConversationRead(userId, conversation);

    const recipients = await this.getRecipientIds(conversation, userId);
    for (const recipient of recipients) {
      this.wsGateway.emitToUser(recipient, 'chat:messages_read', {
        sessionId,
        readBy: userId,
      });
    }

    return { success: true };
  }

  async findOrCreateSession(userId: string, dto: StartSessionDto) {
    if (userId === dto.recipientId) {
      throw new BadRequestException(
        'Cannot start a conversation with yourself',
      );
    }
    if (dto.recipientId === AI_SYSTEM_USER_ID) {
      throw new BadRequestException(
        'Use POST /chat/sessions/platform to open the AI-консультант chat.',
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
        type: ChatSessionType.Expert,
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
    sessionId: string;
    senderId: string;
    text: string;
  }): Promise<ChatMessage> {
    const message = this.messageRepository.create({
      sessionId: input.sessionId,
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
    sessionId: string,
    userId: string,
    role: ChatParticipantRole,
  ): Promise<void> {
    const existing = await this.participantRepository.findOne({
      where: { sessionId, userId },
    });
    if (existing) return;
    const participant = this.participantRepository.create({
      sessionId,
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
    conversation: ChatSession,
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
    conversation: ChatSession,
    cursor?: Date | null,
  ): Promise<void> {
    if (conversation.type === ChatSessionType.Platform) {
      // Cursor defaults to the newest existing message's timestamp — resolved
      // here so callers like markAsRead don't need to fetch it themselves.
      // Using createdAt of an actual message (not NOW()) makes the read
      // marker race-free: a message inserted after our fetch has a strictly
      // greater createdAt and stays unread until the next read pass.
      let effectiveCursor = cursor ?? null;
      if (!effectiveCursor) {
        const latest = await this.messageRepository.findOne({
          where: { sessionId: conversation.id },
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
        .update(ChatSessionParticipant)
        .set({
          lastReadAt: () =>
            'GREATEST(COALESCE("lastReadAt", :cursor), :cursor)',
        })
        .where('"sessionId" = :sessionId', {
          sessionId: conversation.id,
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
      .where('sessionId = :sessionId', {
        sessionId: conversation.id,
      })
      .andWhere('senderId != :userId', { userId })
      .andWhere('isRead = false')
      .execute();
  }

  private async computeUnreadCount(
    conversation: ChatSession,
    userId: string,
  ): Promise<number> {
    if (conversation.type === ChatSessionType.Platform) {
      const participant = await this.participantRepository.findOne({
        where: { sessionId: conversation.id, userId },
      });
      const qb = this.messageRepository
        .createQueryBuilder('m')
        .where('m."sessionId" = :sessionId', {
          sessionId: conversation.id,
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
      .where('m."sessionId" = :sessionId', {
        sessionId: conversation.id,
      })
      .andWhere('m."isRead" = false')
      .andWhere('m."senderId" != :userId', { userId })
      .getCount();
  }

  private async getRecipientIds(
    conversation: ChatSession,
    excludeUserId: string,
  ): Promise<string[]> {
    if (conversation.type === ChatSessionType.Platform) {
      const participants = await this.participantRepository.find({
        where: { sessionId: conversation.id },
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
    conversation: ChatSession,
  ): Promise<void> {
    if (conversation.type === ChatSessionType.Platform) {
      // QIR-687 supersedes the QIR-256 "no admin back-door" rule: admins act
      // as operators for the AI-chat inbox and need read + reply access to
      // every platform session. Regular users still must be listed in the
      // participants table.
      const membership = await this.participantRepository.findOne({
        where: { sessionId: conversation.id, userId },
      });
      if (membership) return;

      const requester = await this.requireUserById(userId, 'User not found');
      if (requester.role === UserRole.ADMIN) return;

      throw new ForbiddenException(
        'You are not a participant of this conversation',
      );
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

// Extracted from inline ternary literals so prettier's continuation indent
// stops clashing with eslint's `indent` rule. Callers just receive an object
// or null and drop it into the response shape.
function pickParticipant(
  user: User | null,
): { id: string; name: string; lastName: string; email: string } | null {
  if (!user) return null;
  return {
    id: user.id,
    name: user.name,
    lastName: user.lastName,
    email: user.email,
  };
}

function pickLastMessagePreview(message: ChatMessage | null): {
  id: string;
  text: string;
  senderId: string;
  isAiGenerated: boolean;
  createdAt: Date;
} | null {
  if (!message) return null;
  return {
    id: message.id,
    text: message.text,
    senderId: message.senderId,
    isAiGenerated: message.isAiGenerated,
    createdAt: message.createdAt,
  };
}
