import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ChatConversation } from './entities/chat-conversation.entity';
import { ChatMessage } from './entities/chat-message.entity';
import { WebSocketGatewayService } from '../websocket/websocket.gateway';
import { SendMessageDto } from './dto/send-message.dto';
import { GetConversationsQueryDto } from './dto/get-conversations-query.dto';
import { GetMessagesQueryDto } from './dto/get-messages-query.dto';
import { User } from '../users/entities/user.entity';

@Injectable()
export class ChatService {
  constructor(
    @InjectRepository(ChatConversation)
    private readonly conversationRepository: Repository<ChatConversation>,
    @InjectRepository(ChatMessage)
    private readonly messageRepository: Repository<ChatMessage>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly wsGateway: WebSocketGatewayService,
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

    if (
      conversation.participantOneId !== userId &&
      conversation.participantTwoId !== userId
    ) {
      throw new ForbiddenException('You are not a participant of this conversation');
    }

    const [messages, total] = await this.messageRepository.findAndCount({
      where: { conversationId },
      order: { createdAt: 'DESC' },
      skip: offset,
      take: limit,
    });

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

    return { data: messages, total, offset, limit };
  }

  async sendMessage(userId: string, dto: SendMessageDto) {
    if (userId === dto.recipientId) {
      throw new BadRequestException('Cannot send a message to yourself');
    }

    // Normalize participant order: smaller UUID = participantOne
    const [participantOneId, participantTwoId] =
      userId < dto.recipientId
        ? [userId, dto.recipientId]
        : [dto.recipientId, userId];

    // Find or create conversation
    let conversation = await this.conversationRepository.findOne({
      where: { participantOneId, participantTwoId },
    });

    if (!conversation) {
      conversation = this.conversationRepository.create({
        participantOneId,
        participantTwoId,
      });
      conversation = await this.conversationRepository.save(conversation);
    }

    // Save message
    const message = this.messageRepository.create({
      conversationId: conversation.id,
      senderId: userId,
      text: dto.text,
    });
    const savedMessage = await this.messageRepository.save(message);

    // Touch conversation updatedAt
    await this.conversationRepository.update(conversation.id, {
      updatedAt: new Date(),
    });

    const payload = {
      message: savedMessage,
      conversation: {
        id: conversation.id,
        updatedAt: new Date(),
      },
    };

    // Emit to both users
    this.wsGateway.emitToUser(userId, 'chat:new_message', payload);
    this.wsGateway.emitToUser(dto.recipientId, 'chat:new_message', payload);

    return savedMessage;
  }

  async markAsRead(userId: string, conversationId: string) {
    const conversation = await this.conversationRepository.findOne({
      where: { id: conversationId },
    });

    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }

    if (
      conversation.participantOneId !== userId &&
      conversation.participantTwoId !== userId
    ) {
      throw new ForbiddenException('You are not a participant of this conversation');
    }

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

  async findOrCreateConversation(userId: string, recipientId: string) {
    if (userId === recipientId) {
      throw new BadRequestException('Cannot start a conversation with yourself');
    }

    const recipient = await this.userRepository.findOne({
      where: { id: recipientId },
    });
    if (!recipient) {
      throw new NotFoundException('Recipient not found');
    }

    const [participantOneId, participantTwoId] =
      userId < recipientId
        ? [userId, recipientId]
        : [recipientId, userId];

    let conversation = await this.conversationRepository.findOne({
      where: { participantOneId, participantTwoId },
    });

    if (!conversation) {
      conversation = this.conversationRepository.create({
        participantOneId,
        participantTwoId,
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
      updatedAt: conversation.updatedAt,
    };
  }
}
