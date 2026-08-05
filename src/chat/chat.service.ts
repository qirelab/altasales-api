import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, IsNull, Repository } from 'typeorm';
import { WebSocketGatewayService } from '../websocket/websocket.gateway';
import { FilesService } from '../files/files.service';
import { User } from '../users/entities/user.entity';
import { UserRole } from '../users/entities/user-role.enum';
import { Order } from '../orders/entities/order.entity';
import { OrderStatus } from '../orders/entities/order-status.enum';
import { ServiceType } from '../services/entities/service-type.enum';
import { ChatParticipantRole } from './entities/chat-participant-role.enum';
import { ChatSessionType } from './entities/chat-session-type.enum';
import { ChatSessionParticipant } from './entities/chat-session-participant.entity';
import { ChatMessage } from './entities/chat-message.entity';
import { ChatSession } from './entities/chat-session.entity';
import { GetMessagesQueryDto } from './dto/get-messages-query.dto';
import { GetSessionsQueryDto } from './dto/get-sessions-query.dto';
import { SendMessageDto } from './dto/send-message.dto';
import { StartSessionDto } from './dto/start-session.dto';
import { AI_SYSTEM_USER_ID } from './chat.constants';
import { ChatHandoffStatus } from './entities/chat-handoff-status.enum';
import { AiChatOrchestratorService } from './services/ai-chat-orchestrator.service';
import { HandoffService } from './services/handoff.service';
import { SendPlatformMessageDto } from './dto/send-platform-message.dto';
import { SessionTitleService } from './services/session-title.service';

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

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
    private readonly handoffService: HandoffService,
    private readonly dataSource: DataSource,
  ) {}

  async getSessions(userId: string, query: GetSessionsQueryDto) {
    const { offset = 0, limit = 20, type } = query;

    // Self-heal: purchases made before expert-service chats still need a
    // session. Cheap when already backfilled (idempotent find-or-create).
    if (!type || type === ChatSessionType.Expert) {
      await this.ensureExpertSessionsForUser(userId);
    }

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

    if (type) {
      qb.andWhere('conv.type = :type', { type });
    }

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
   * Send a message inside a platform or expert-service conversation.
   *
   * When the client sends → we persist the message and schedule an async AI
   * reply (unless handoff is active or the expert-order is completed). When
   * an expert or operator sends → we persist and broadcast, but do NOT
   * trigger the AI. Non-participants get 403.
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
    if (
      conversation.type !== ChatSessionType.Platform &&
      conversation.type !== ChatSessionType.Expert
    ) {
      throw new BadRequestException(
        'This endpoint accepts only platform or expert-type conversations',
      );
    }

    const membership = await this.participantRepository.findOne({
      where: { sessionId: conversation.id, userId },
    });
    const isLegacyPairMember =
      conversation.type === ChatSessionType.Expert &&
      (conversation.participantOneId === userId ||
        conversation.participantTwoId === userId);
    if (!membership && !isLegacyPairMember) {
      throw new ForbiddenException(
        'You are not a participant of this conversation',
      );
    }

    const role =
      membership?.role ?? (await this.inferLegacyRole(userId, conversation));

    const savedMessage = await this.persistMessage({
      sessionId: conversation.id,
      senderId: userId,
      text: dto.text,
    });
    const files = await this.linkFilesToMessage(dto.fileIds, savedMessage.id);
    const now = new Date();

    const isHumanReplierTurn =
      role !== ChatParticipantRole.Client && role !== ChatParticipantRole.Ai;

    await this.conversationRepository.update(conversation.id, {
      updatedAt: now,
    });

    if (role === ChatParticipantRole.Client && !conversation.title) {
      void this.sessionTitleService.generateAndAssign(
        conversation.id,
        dto.text,
      );
    }

    let handoffResolved = false;
    if (isHumanReplierTurn && conversation.type === ChatSessionType.Platform) {
      const result = await this.conversationRepository
        .createQueryBuilder()
        .update(ChatSession)
        .set({
          needsHumanHandoff: false,
          handoffTrigger: null,
          handoffRequestedAt: null,
          handoffStatus: ChatHandoffStatus.Resolved,
          handoffResolvedAt: now,
        })
        .where('id = :id', { id: conversation.id })
        .andWhere('"needsHumanHandoff" = true')
        .execute();
      handoffResolved = (result.affected ?? 0) > 0;
    }

    if (
      isHumanReplierTurn &&
      conversation.type === ChatSessionType.Expert &&
      role === ChatParticipantRole.Expert
    ) {
      // Any expert message → in_progress, AI off until explicit resolve.
      await this.handoffService.ensureExpertActiveOnReply(
        conversation.id,
        userId,
      );
    }

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

    if (handoffResolved) {
      const resolvedBy = await this.requireUserById(
        userId,
        'User not found',
      ).catch(() => null);
      const handoffPayload = {
        sessionId: conversation.id,
        resolvedAt: now,
        handoffStatus: ChatHandoffStatus.Resolved,
        resolvedBy: pickParticipant(resolvedBy),
      };
      this.wsGateway.emitToUser(
        userId,
        'chat:handoff_resolved',
        handoffPayload,
      );
      for (const recipientId of recipientIds) {
        this.wsGateway.emitToUser(
          recipientId,
          'chat:handoff_resolved',
          handoffPayload,
        );
      }
    }

    const handoffPaused = this.handoffService.isAiPausedByHandoff(conversation);
    const aiDisabledByCompletedOrder =
      conversation.type === ChatSessionType.Expert &&
      (await this.isExpertOrderCompleted(conversation.orderId));

    if (
      role === ChatParticipantRole.Client &&
      !handoffPaused &&
      !aiDisabledByCompletedOrder
    ) {
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
   * Ensure a `type=expert` session exists for a paid order with an assigned
   * expert. Idempotent. Participants: client, AI, expert. Chat is never
   * deleted — history survives order completion.
   */
  async ensureExpertServiceSession(
    clientUserId: string,
    expertUserId: string,
    orderId: string,
    title?: string | null,
  ): Promise<ChatSession> {
    if (clientUserId === expertUserId) {
      throw new BadRequestException(
        'Cannot create expert service chat with the same user as client and expert',
      );
    }

    const [participantOneId, participantTwoId] =
      clientUserId < expertUserId
        ? [clientUserId, expertUserId]
        : [expertUserId, clientUserId];

    const existing = await this.conversationRepository.findOne({
      where: {
        participantOneId,
        participantTwoId,
        orderId,
        type: ChatSessionType.Expert,
      },
    });
    if (existing) {
      await this.ensureParticipant(
        existing.id,
        clientUserId,
        ChatParticipantRole.Client,
      );
      await this.ensureParticipant(
        existing.id,
        AI_SYSTEM_USER_ID,
        ChatParticipantRole.Ai,
      );
      await this.ensureParticipant(
        existing.id,
        expertUserId,
        ChatParticipantRole.Expert,
      );
      if (title && !existing.title) {
        await this.conversationRepository.update(existing.id, { title });
        existing.title = title;
      }
      return existing;
    }

    return this.dataSource.transaction(async (manager) => {
      const session = manager.getRepository(ChatSession).create({
        participantOneId,
        participantTwoId,
        orderId,
        type: ChatSessionType.Expert,
        title: title ?? null,
      });
      const saved = await manager.getRepository(ChatSession).save(session);
      await manager.getRepository(ChatSessionParticipant).save([
        manager.getRepository(ChatSessionParticipant).create({
          sessionId: saved.id,
          userId: clientUserId,
          role: ChatParticipantRole.Client,
        }),
        manager.getRepository(ChatSessionParticipant).create({
          sessionId: saved.id,
          userId: AI_SYSTEM_USER_ID,
          role: ChatParticipantRole.Ai,
        }),
        manager.getRepository(ChatSessionParticipant).create({
          sessionId: saved.id,
          userId: expertUserId,
          role: ChatParticipantRole.Expert,
        }),
      ]);
      return saved;
    });
  }

  /**
   * Called after orders leave pending_payment (balance checkout or Robokassa
   * result). Creates expert-service sessions for every paid order that has
   * an assigned expert executor.
   */
  async ensureExpertSessionsForPaidOrders(orderIds: string[]): Promise<void> {
    if (orderIds.length === 0) return;
    const orders = await this.orderRepository.find({
      where: { id: In(orderIds) },
      relations: [
        'item',
        'item.service',
        'item.service.category',
        'item.package',
        'item.expertPosition',
      ],
    });

    for (const order of orders) {
      await this.ensureExpertSessionForOrder(order);
    }
  }

  /**
   * Backfill / self-heal: create missing expert-service sessions for every
   * paid order linked to this user as client or as expert executor. Used when
   * opening chat lists so purchases made before the feature still get a chat
   * even if the data migration has not run yet.
   */
  async ensureExpertSessionsForUser(userId: string): Promise<void> {
    const asClient = await this.orderRepository
      .createQueryBuilder('o')
      .leftJoinAndSelect('o.item', 'item')
      .leftJoinAndSelect('item.service', 'service')
      .leftJoinAndSelect('service.category', 'category')
      .leftJoinAndSelect('item.package', 'package')
      .leftJoinAndSelect('item.expertPosition', 'expertPosition')
      .where('o."userId" = :userId', { userId })
      .andWhere('o.status NOT IN (:...excluded)', {
        excluded: [OrderStatus.PendingPayment, OrderStatus.Cancelled],
      })
      .getMany();

    const asExpert = await this.orderRepository
      .createQueryBuilder('o')
      .leftJoinAndSelect('o.item', 'item')
      .leftJoinAndSelect('item.service', 'service')
      .leftJoinAndSelect('service.category', 'category')
      .leftJoinAndSelect('item.package', 'package')
      .leftJoinAndSelect('item.expertPosition', 'expertPosition')
      .where('o.status NOT IN (:...excluded)', {
        excluded: [OrderStatus.PendingPayment, OrderStatus.Cancelled],
      })
      .andWhere(
        '(item."executorUserId" = :userId OR (service.type = :contractorType AND service."userId" = :userId))',
        { userId, contractorType: ServiceType.Contractor },
      )
      .getMany();

    const byId = new Map<string, Order>();
    for (const order of [...asClient, ...asExpert]) {
      byId.set(order.id, order);
    }
    for (const order of byId.values()) {
      await this.ensureExpertSessionForOrder(order);
    }
  }

  private async ensureExpertSessionForOrder(order: Order): Promise<void> {
    if (
      order.status === OrderStatus.PendingPayment ||
      order.status === OrderStatus.Cancelled
    ) {
      return;
    }
    const expertUserId = this.resolveOrderExpertUserId(order);
    if (!expertUserId || expertUserId === order.userId) {
      return;
    }
    const title = this.resolveOrderOfferingTitle(order);
    try {
      await this.ensureExpertServiceSession(
        order.userId,
        expertUserId,
        order.id,
        title,
      );
    } catch (error) {
      this.logger.error(
        `ensureExpertServiceSession failed for order ${order.id}: ${
          error instanceof Error ? error.message : String(error)
        }`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  /**
   * Add an expert as a participant of ALL of the client's existing platform
   * sessions.
   *
   * LEGACY (contractorChatAccess admin grant). New expert-service product
   * path uses dedicated `type=expert` sessions via
   * {@link ensureExpertServiceSession} and does NOT join platform threads.
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
    const useParticipantCursor =
      await this.shouldUseParticipantReadCursor(conversation);
    if (useParticipantCursor) {
      let effectiveCursor = cursor ?? null;
      if (!effectiveCursor) {
        const latest = await this.messageRepository.findOne({
          where: { sessionId: conversation.id },
          order: { createdAt: 'DESC' },
        });
        effectiveCursor = latest?.createdAt ?? null;
      }
      if (!effectiveCursor) return;
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
    const useParticipantCursor =
      await this.shouldUseParticipantReadCursor(conversation);
    if (useParticipantCursor) {
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

  private async shouldUseParticipantReadCursor(
    conversation: ChatSession,
  ): Promise<boolean> {
    if (conversation.type === ChatSessionType.Platform) return true;
    if (conversation.type !== ChatSessionType.Expert) return false;
    const ai = await this.participantRepository.findOne({
      where: {
        sessionId: conversation.id,
        userId: AI_SYSTEM_USER_ID,
        role: ChatParticipantRole.Ai,
      },
    });
    return Boolean(ai);
  }

  private async getRecipientIds(
    conversation: ChatSession,
    excludeUserId: string,
  ): Promise<string[]> {
    const participants = await this.participantRepository.find({
      where: { sessionId: conversation.id },
    });
    if (participants.length > 0) {
      return participants
        .map((p) => p.userId)
        .filter((id) => id !== excludeUserId && id !== AI_SYSTEM_USER_ID);
    }
    // Legacy expert-type without participant rows: two-party layout.
    return conversation.participantOneId === excludeUserId
      ? [conversation.participantTwoId]
      : [conversation.participantOneId];
  }

  private async assertConversationAccess(
    userId: string,
    conversation: ChatSession,
  ): Promise<void> {
    const membership = await this.participantRepository.findOne({
      where: { sessionId: conversation.id, userId },
    });
    if (membership) return;

    if (conversation.type === ChatSessionType.Platform) {
      // Operators (admins) need back-door read access to every platform session.
      const requester = await this.requireUserById(userId, 'User not found');
      if (requester.role === UserRole.ADMIN) return;

      throw new ForbiddenException(
        'You are not a participant of this conversation',
      );
    }

    // Expert service chats are isolated from operators — no admin back-door.
    // Access only via participants table or legacy pair + order entitlement.
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

    // Auto-created paid expert sessions do not require contractorChatAccess.
    // Legacy DMs still gate on the flag when the AI participant is absent.
    const hasAi = await this.participantRepository.findOne({
      where: {
        sessionId: conversation.id,
        userId: AI_SYSTEM_USER_ID,
        role: ChatParticipantRole.Ai,
      },
    });
    if (hasAi) {
      const order = await this.orderRepository.findOne({
        where: { id: conversation.orderId },
        relations: ['item', 'item.service'],
      });
      if (!order) {
        throw new ForbiddenException('Linked order not found');
      }
      const expertId = this.resolveOrderExpertUserId(order);
      const allowed = new Set(
        [order.userId, expertId].filter((id): id is string => Boolean(id)),
      );
      if (!allowed.has(userId)) {
        throw new ForbiddenException(
          'You are not entitled to this expert service chat',
        );
      }
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

  private resolveOrderExpertUserId(order: Order): string | null {
    if (order.item?.executorUserId) {
      return order.item.executorUserId;
    }
    const service = order.item?.service;
    if (service?.type === ServiceType.Contractor && service.userId) {
      return service.userId;
    }
    return null;
  }

  private resolveOrderOfferingTitle(order: Order): string | null {
    const item = order.item;
    if (!item) return null;
    if (item.service?.name) return item.service.name;
    if (item.package?.name) return item.package.name;
    if (item.expertPosition?.name) return item.expertPosition.name;
    return null;
  }

  private async isExpertOrderCompleted(
    orderId: string | null,
  ): Promise<boolean> {
    if (!orderId) return false;
    const order = await this.orderRepository.findOne({
      where: { id: orderId },
      select: ['id', 'status'],
    });
    return order?.status === OrderStatus.Completed;
  }

  private async inferLegacyRole(
    userId: string,
    _conversation: ChatSession,
  ): Promise<ChatParticipantRole> {
    const user = await this.requireUserById(userId, 'User not found');
    return this.mapUserRoleToParticipantRole(user.role);
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
