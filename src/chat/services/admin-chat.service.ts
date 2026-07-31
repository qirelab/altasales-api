import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Not, Repository } from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { WebSocketGatewayService } from '../../websocket/websocket.gateway';
import { AI_SYSTEM_USER_ID } from '../chat.constants';
import { ChatHandoffStatus } from '../entities/chat-handoff-status.enum';
import { ChatMessage } from '../entities/chat-message.entity';
import { ChatParticipantRole } from '../entities/chat-participant-role.enum';
import { ChatSession } from '../entities/chat-session.entity';
import { ChatSessionParticipant } from '../entities/chat-session-participant.entity';
import { ChatSessionType } from '../entities/chat-session-type.enum';

export type OperatorSessionFilter = 'active' | 'resolved';

export type OperatorSessionView = {
  id: string;
  type: string;
  title: string | null;
  updatedAt: Date;
  participant: { id: string; name: string; lastName: string; email: string } | null;
  lastMessage: {
    id: string;
    text: string;
    senderId: string;
    isAiGenerated: boolean;
    createdAt: Date;
  } | null;
  needsHumanHandoff: boolean;
  handoffStatus: ChatHandoffStatus | null;
  handoffRequestedAt: Date | null;
  handoffClaimedAt: Date | null;
  handoffResolvedAt: Date | null;
  assignedOperatorId: string | null;
  assignedOperator: {
    id: string;
    name: string;
    lastName: string;
    email: string;
  } | null;
};

const ACTIVE_STATUSES = [
  ChatHandoffStatus.Awaiting,
  ChatHandoffStatus.InProgress,
] as const;

@Injectable()
export class AdminChatService {
  private readonly logger = new Logger(AdminChatService.name);

  constructor(
    @InjectRepository(ChatSession)
    private readonly sessionRepository: Repository<ChatSession>,
    @InjectRepository(ChatSessionParticipant)
    private readonly participantRepository: Repository<ChatSessionParticipant>,
    @InjectRepository(ChatMessage)
    private readonly messageRepository: Repository<ChatMessage>,
    private readonly dataSource: DataSource,
    private readonly wsGateway: WebSocketGatewayService,
  ) {}

  async listOperatorSessions(
    filter: OperatorSessionFilter,
  ): Promise<OperatorSessionView[]> {
    const where = filter === 'resolved'
      ? { type: ChatSessionType.Platform, handoffStatus: ChatHandoffStatus.Resolved }
      : { type: ChatSessionType.Platform, handoffStatus: In(ACTIVE_STATUSES as unknown as ChatHandoffStatus[]) };
    const rows = await this.sessionRepository.find({
      where,
      relations: ['participantOne', 'participantTwo', 'assignedOperator'],
      order: { updatedAt: 'DESC' },
      take: 200,
    });
    return Promise.all(rows.map((row) => this.toView(row)));
  }

  async claim(operatorId: string, sessionId: string): Promise<OperatorSessionView> {
    const session = await this.loadPlatformSession(sessionId);
    if (session.handoffStatus === ChatHandoffStatus.InProgress) {
      if (session.assignedOperatorId === operatorId) return this.toView(session);
      throw new ConflictException(
        'Session is already being handled by another operator',
      );
    }
    if (session.handoffStatus !== ChatHandoffStatus.Awaiting) {
      throw new BadRequestException(
        'Only sessions awaiting an operator can be claimed',
      );
    }

    const claimedAt = new Date();
    await this.dataSource.transaction(async (manager) => {
      const result = await manager
        .createQueryBuilder()
        .update(ChatSession)
        .set({
          handoffStatus: ChatHandoffStatus.InProgress,
          assignedOperatorId: operatorId,
          handoffClaimedAt: claimedAt,
          updatedAt: claimedAt,
        })
        .where('id = :id', { id: sessionId })
        .andWhere('"handoffStatus" = :awaiting', {
          awaiting: ChatHandoffStatus.Awaiting,
        })
        .execute();
      if ((result.affected ?? 0) === 0) {
        throw new ConflictException(
          'Session was claimed by another operator moments ago',
        );
      }

      const existing = await manager.getRepository(ChatSessionParticipant).findOne({
        where: { sessionId, userId: operatorId },
      });
      if (!existing) {
        await manager.getRepository(ChatSessionParticipant).save(
          manager.getRepository(ChatSessionParticipant).create({
            sessionId,
            userId: operatorId,
            role: ChatParticipantRole.Operator,
          }),
        );
      }
    });

    const fresh = await this.loadPlatformSession(sessionId);
    this.broadcast(fresh, operatorId, 'chat:handoff_claimed', {
      sessionId: fresh.id,
      operatorId,
      claimedAt,
      handoffStatus: fresh.handoffStatus,
    });
    return this.toView(fresh);
  }

  async resolve(
    operatorId: string,
    sessionId: string,
  ): Promise<OperatorSessionView> {
    const session = await this.loadPlatformSession(sessionId);
    if (session.handoffStatus !== ChatHandoffStatus.InProgress) {
      throw new BadRequestException(
        'Only sessions in progress can be resolved',
      );
    }
    if (session.assignedOperatorId && session.assignedOperatorId !== operatorId) {
      throw new ForbiddenException(
        'This session is assigned to another operator',
      );
    }

    const resolvedAt = new Date();
    const result = await this.sessionRepository
      .createQueryBuilder()
      .update(ChatSession)
      .set({
        handoffStatus: ChatHandoffStatus.Resolved,
        needsHumanHandoff: false,
        handoffResolvedAt: resolvedAt,
        updatedAt: resolvedAt,
      })
      .where('id = :id', { id: sessionId })
      .andWhere('"handoffStatus" = :inProgress', {
        inProgress: ChatHandoffStatus.InProgress,
      })
      .execute();
    if ((result.affected ?? 0) === 0) {
      throw new ConflictException(
        'Session was resolved or re-assigned moments ago',
      );
    }

    const fresh = await this.loadPlatformSession(sessionId);
    this.broadcast(fresh, operatorId, 'chat:handoff_resolved', {
      sessionId: fresh.id,
      resolvedAt,
      handoffStatus: fresh.handoffStatus,
    });
    return this.toView(fresh);
  }

  private async loadPlatformSession(sessionId: string): Promise<ChatSession> {
    const session = await this.sessionRepository.findOne({
      where: { id: sessionId, type: ChatSessionType.Platform },
      relations: ['participantOne', 'participantTwo', 'assignedOperator'],
    });
    if (!session) {
      throw new NotFoundException('Platform session not found');
    }
    return session;
  }

  private async broadcast(
    session: ChatSession,
    initiatorId: string,
    event: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const participants = await this.participantRepository.find({
      where: { sessionId: session.id, userId: Not(initiatorId) },
    });
    for (const participant of participants) {
      this.wsGateway.emitToUser(participant.userId, event, payload);
    }
    // Deliver to the initiator's other sockets too so the operator inbox
    // updates instantly across their open tabs.
    this.wsGateway.emitToUser(initiatorId, event, payload);
    this.logger.log({
      eventName: 'ADMIN_CHAT_HANDOFF_EVENT',
      event,
      sessionId: session.id,
      status: session.handoffStatus,
    });
  }

  private async toView(session: ChatSession): Promise<OperatorSessionView> {
    const client = pickClient(session);
    const lastMessage = await this.messageRepository.findOne({
      where: { sessionId: session.id },
      order: { createdAt: 'DESC' },
    });
    return {
      id: session.id,
      type: session.type,
      title: session.title,
      updatedAt: session.updatedAt,
      participant: pickUser(client),
      lastMessage: lastMessage
        ? {
          id: lastMessage.id,
          text: lastMessage.text,
          senderId: lastMessage.senderId,
          isAiGenerated: lastMessage.isAiGenerated,
          createdAt: lastMessage.createdAt,
        }
        : null,
      needsHumanHandoff: session.needsHumanHandoff,
      handoffStatus: session.handoffStatus,
      handoffRequestedAt: session.handoffRequestedAt,
      handoffClaimedAt: session.handoffClaimedAt,
      handoffResolvedAt: session.handoffResolvedAt,
      assignedOperatorId: session.assignedOperatorId,
      assignedOperator: pickUser(session.assignedOperator),
    };
  }
}

function pickClient(session: ChatSession): User | null {
  // Platform sessions: one participant is the AI system user, the other is
  // the client. Legacy expert sessions: both are real users; we surface
  // whichever is NOT the AI (defaults to participantOne).
  if (session.participantOne && session.participantOne.id !== AI_SYSTEM_USER_ID) {
    return session.participantOne;
  }
  if (session.participantTwo && session.participantTwo.id !== AI_SYSTEM_USER_ID) {
    return session.participantTwo;
  }
  return null;
}

function pickUser(
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
