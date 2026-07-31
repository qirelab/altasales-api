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
import { WebSocketGatewayService } from '../../websocket/websocket.gateway';
import { ChatHandoffStatus } from '../entities/chat-handoff-status.enum';
import { ChatParticipantRole } from '../entities/chat-participant-role.enum';
import { ChatSession } from '../entities/chat-session.entity';
import { ChatSessionParticipant } from '../entities/chat-session-participant.entity';
import { ChatSessionType } from '../entities/chat-session-type.enum';

export type OperatorSessionFilter = 'active' | 'resolved';

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
    private readonly dataSource: DataSource,
    private readonly wsGateway: WebSocketGatewayService,
  ) {}

  async listOperatorSessions(
    filter: OperatorSessionFilter,
  ): Promise<ChatSession[]> {
    const where = filter === 'resolved'
      ? { type: ChatSessionType.Platform, handoffStatus: ChatHandoffStatus.Resolved }
      : { type: ChatSessionType.Platform, handoffStatus: In(ACTIVE_STATUSES as unknown as ChatHandoffStatus[]) };
    return this.sessionRepository.find({
      where,
      relations: ['participantOne', 'participantTwo', 'assignedOperator'],
      order: { updatedAt: 'DESC' },
      take: 200,
    });
  }

  async claim(operatorId: string, sessionId: string): Promise<ChatSession> {
    const session = await this.loadPlatformSession(sessionId);
    if (session.handoffStatus === ChatHandoffStatus.InProgress) {
      if (session.assignedOperatorId === operatorId) return session;
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
    return fresh;
  }

  async resolve(
    operatorId: string,
    sessionId: string,
  ): Promise<ChatSession> {
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
    return fresh;
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
}
