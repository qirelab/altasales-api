import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { ChatConversation } from './entities/chat-conversation.entity';
import { ChatMessage } from './entities/chat-message.entity';
import { WebSocketGatewayService } from '../websocket/websocket.gateway';
import { FilesService } from '../files/files.service';
import { SendMessageDto } from './dto/send-message.dto';
import { GetConversationsQueryDto } from './dto/get-conversations-query.dto';
import { GetMessagesQueryDto } from './dto/get-messages-query.dto';
import { User } from '../users/entities/user.entity';
import { UserRole } from '../users/entities/user-role.enum';
import { Order } from '../orders/entities/order.entity';
import { ServiceType } from '../services/entities/service-type.enum';
import { StartConversationDto } from './dto/start-conversation.dto';

@Injectable()
export class ChatService {
  constructor(
    @InjectRepository(ChatConversation)
    private readonly conversationRepository: Repository<ChatConversation>,
    @InjectRepository(ChatMessage)
    private readonly messageRepository: Repository<ChatMessage>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(Order)
    private readonly orderRepository: Repository<Order>,
    private readonly wsGateway: WebSocketGatewayService,
    private readonly filesService: FilesService,
  ) {}

  async getConversations(userId: string, query: GetConversationsQueryDto) {
    const { offset = 0, limit = 20 } = query;

    const qb = this.conversationRepository
      .createQueryBuilder('conv')
      .where(
        'conv.participantOneId = :userId OR conv.participantTwoId = :userId',
        { userId },
      )
      .leftJoinAndSelect('conv.participantOne', 'p1')
      .leftJoinAndSelect('conv.participantTwo', 'p2')
      .orderBy('conv.updatedAt', 'DESC')
      .skip(offset)
      .take(limit);

    const [conversations, total] = await qb.getManyAndCount();

    const data = await Promise.all(
      conversations.map(async (conv) => {
        const otherUser =
          conv.participantOneId === userId
            ? conv.participantTwo
            : conv.participantOne;

        const lastMessage = await this.messageRepository.findOne({
          where: { conversationId: conv.id },
          order: { createdAt: 'DESC' },
        });

        const unreadCount = await this.messageRepository.count({
          where: {
            conversationId: conv.id,
            isRead: false,
            senderId: otherUser.id,
          },
        });

        return {
          id: conv.id,
          orderId: conv.orderId,
          participant: {
            id: otherUser.id,
            name: otherUser.name,
            lastName: otherUser.lastName,
            email: otherUser.email,
          },
          lastMessage: lastMessage
            ? {
                id: lastMessage.id,
                text: lastMessage.text,
                senderId: lastMessage.senderId,
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

    // Attach files to messages
    const messageIds = messages.map((m) => m.id);
    const allFiles = await this.filesService.findByMessageIds(messageIds);
    const filesByMessageId = new Map<string, { id: string; name: string; size: number; type: string }[]>();
    for (const f of allFiles) {
      const arr = filesByMessageId.get(f.messageId!) ?? [];
      arr.push({ id: f.id, name: f.originalName, size: f.size, type: f.mimeType });
      filesByMessageId.set(f.messageId!, arr);
    }
    const messagesWithFiles = messages.map((m) => ({
      ...m,
      files: filesByMessageId.get(m.id) ?? [],
    }));

    // Mark other user's unread messages as read
    const otherUserId =
      conversation.participantOneId === userId
        ? conversation.participantTwoId
        : conversation.participantOneId;

    await this.messageRepository
      .createQueryBuilder()
      .update(ChatMessage)
      .set({ isRead: true })
      .where('conversationId = :conversationId', { conversationId })
      .andWhere('senderId = :otherUserId', { otherUserId })
      .andWhere('isRead = false')
      .execute();

    this.wsGateway.emitToUser(otherUserId, 'chat:messages_read', {
      conversationId,
      readBy: userId,
    });

    return { data: messagesWithFiles, total, offset, limit };
  }

  async sendMessage(userId: string, dto: SendMessageDto) {
    if (userId === dto.recipientId) {
      throw new BadRequestException('Cannot send a message to yourself');
    }

    const recipient = await this.requireUserById(dto.recipientId, 'Recipient not found');

    // Normalize participant order: smaller UUID = participantOne
    const [participantOneId, participantTwoId] =
      userId < dto.recipientId
        ? [userId, dto.recipientId]
        : [dto.recipientId, userId];
    const normalizedOrderId = dto.orderId ?? null;

    // Find or create conversation
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
      });
      conversation = await this.conversationRepository.save(conversation);
    } else {
      await this.assertConversationAccess(userId, conversation);
    }

    // Save message
    const message = this.messageRepository.create({
      conversationId: conversation.id,
      senderId: userId,
      text: dto.text,
    });
    const savedMessage = await this.messageRepository.save(message);

    // Link files to message
    let files: { id: string; name: string; size: number; type: string }[] = [];
    if (dto.fileIds?.length) {
      await this.filesService.linkToMessage(dto.fileIds, savedMessage.id);
      const fileEntities = await this.filesService.findByIds(dto.fileIds);
      files = fileEntities.map((f) => ({
        id: f.id,
        name: f.originalName,
        size: f.size,
        type: f.mimeType,
      }));
    }

    // Touch conversation updatedAt
    await this.conversationRepository.update(conversation.id, {
      updatedAt: new Date(),
    });

    const messageWithFiles = { ...savedMessage, files };

    const payload = {
      message: messageWithFiles,
      conversation: {
        id: conversation.id,
        updatedAt: new Date(),
      },
    };

    // Emit to both users
    this.wsGateway.emitToUser(userId, 'chat:new_message', payload);
    this.wsGateway.emitToUser(dto.recipientId, 'chat:new_message', payload);

    return messageWithFiles;
  }

  async markAsRead(userId: string, conversationId: string) {
    const conversation = await this.conversationRepository.findOne({
      where: { id: conversationId },
    });

    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }

    await this.assertConversationAccess(userId, conversation);

    const otherUserId =
      conversation.participantOneId === userId
        ? conversation.participantTwoId
        : conversation.participantOneId;

    await this.messageRepository
      .createQueryBuilder()
      .update(ChatMessage)
      .set({ isRead: true })
      .where('conversationId = :conversationId', { conversationId })
      .andWhere('senderId = :otherUserId', { otherUserId })
      .andWhere('isRead = false')
      .execute();

    this.wsGateway.emitToUser(otherUserId, 'chat:messages_read', {
      conversationId,
      readBy: userId,
    });

    return { success: true };
  }

  async findOrCreateConversation(userId: string, dto: StartConversationDto) {
    if (userId === dto.recipientId) {
      throw new BadRequestException('Cannot start a conversation with yourself');
    }

    const recipient = await this.requireUserById(dto.recipientId, 'Recipient not found');
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
      });
      conversation = await this.conversationRepository.save(conversation);
    }

    return {
      id: conversation.id,
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

  private async assertConversationAccess(
    userId: string,
    conversation: ChatConversation,
  ): Promise<void> {
    const user = await this.requireUserById(userId, 'User not found');
    if (user.role === UserRole.ADMIN) {
      return;
    }

    if (
      conversation.participantOneId !== userId &&
      conversation.participantTwoId !== userId
    ) {
      throw new ForbiddenException('You are not a participant of this conversation');
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
      .andWhere('item."executorUserId" = :expertParticipantId', { expertParticipantId })
      .select('item.id', 'id')
      .getRawOne<{ id: string }>();

    return Boolean(matchedPositionExecutor);
  }

  private async requireUserById(userId: string, message: string): Promise<User> {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException(message);
    }
    return user;
  }
}
