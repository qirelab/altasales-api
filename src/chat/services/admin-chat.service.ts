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
import { Questionnaire } from '../../questionnaires/entities/questionnaire.entity';
import { User } from '../../users/entities/user.entity';
import { WebSocketGatewayService } from '../../websocket/websocket.gateway';
import {
  AI_SYSTEM_USER_ID,
  formatHandoffResolvedAnnouncement,
  formatOperatorJoinedAnnouncement,
  formatParticipantDisplayName,
} from '../chat.constants';
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
  participant: {
    id: string;
    name: string;
    lastName: string;
    email: string;
    companyName: string | null;
  } | null;
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
    @InjectRepository(Questionnaire)
    private readonly questionnaireRepository: Repository<Questionnaire>,
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
    if (rows.length === 0) return [];

    // Batch the two per-session lookups that toView() otherwise runs one at a
    // time (up to 2×200 round-trips). Fetch the latest message per session in
    // a single window query and questionnaires for all client ids in one IN.
    const sessionIds = rows.map((r) => r.id);
    const clientIds = rows
      .map((r) => pickClient(r)?.id)
      .filter((id): id is string => Boolean(id));

    const lastMessages = sessionIds.length > 0
      ? await this.messageRepository
        .createQueryBuilder('m')
        .distinctOn(['m."sessionId"'])
        .where('m."sessionId" IN (:...ids)', { ids: sessionIds })
        .orderBy('m."sessionId"')
        .addOrderBy('m."createdAt"', 'DESC')
        .getMany()
      : [];
    const lastMessageBySession = new Map<string, ChatMessage>();
    for (const m of lastMessages) lastMessageBySession.set(m.sessionId, m);

    const questionnaires = clientIds.length > 0
      ? await this.questionnaireRepository.find({
        where: { userId: In(clientIds) },
      })
      : [];
    const companyByUserId = new Map<string, string | null>();
    for (const q of questionnaires) {
      const raw = q.answers?.companyName;
      const trimmed = typeof raw === 'string' ? raw.trim() : '';
      companyByUserId.set(q.userId, trimmed.length > 0 ? trimmed : null);
    }

    return rows.map((row) => this.toView(
      row,
      lastMessageBySession.get(row.id) ?? null,
      companyByUserId.get(pickClient(row)?.id ?? '') ?? null,
    ));
  }

  async claim(operatorId: string, sessionId: string): Promise<OperatorSessionView> {
    const session = await this.loadPlatformSession(sessionId);
    if (session.handoffStatus === ChatHandoffStatus.InProgress) {
      if (session.assignedOperatorId === operatorId) return this.loadSingleView(session);
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
    await this.postAiAnnouncement(
      fresh,
      formatOperatorJoinedAnnouncement(
        formatParticipantDisplayName(fresh.assignedOperator),
      ),
      claimedAt,
    );
    this.broadcast(fresh, operatorId, 'chat:handoff_claimed', {
      sessionId: fresh.id,
      operatorId,
      operator: pickUser(fresh.assignedOperator, null),
      claimedAt,
      handoffStatus: fresh.handoffStatus,
    });
    return this.loadSingleView(fresh);
  }

  /**
   * Persist a natural AI bubble and fan out `chat:new_message` to every
   * participant. Used for claim / resolve so the client transcript shows
   * handoff transitions as normal AI replies, not gray service lines.
   */
  private async postAiAnnouncement(
    session: ChatSession,
    text: string,
    at: Date,
  ): Promise<void> {
    const announcement = this.messageRepository.create({
      sessionId: session.id,
      senderId: AI_SYSTEM_USER_ID,
      text,
      isAiGenerated: true,
      createdAt: at,
    });
    const saved = await this.messageRepository.save(announcement);
    // Bump session.updatedAt to the announcement time so sidebar listings
    // (which order by updatedAt DESC) surface the new message immediately.
    await this.sessionRepository.update(session.id, { updatedAt: saved.createdAt });
    const payload = {
      message: { ...saved, files: [] },
      session: {
        id: session.id,
        updatedAt: saved.createdAt,
        title: session.title,
      },
    };
    const participants = await this.participantRepository.find({
      where: { sessionId: session.id },
    });
    for (const p of participants) {
      this.wsGateway.emitToUser(p.userId, 'chat:new_message', payload);
    }
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
    await this.postAiAnnouncement(
      fresh,
      formatHandoffResolvedAnnouncement(
        formatParticipantDisplayName(fresh.assignedOperator),
      ),
      resolvedAt,
    );
    this.broadcast(fresh, operatorId, 'chat:handoff_resolved', {
      sessionId: fresh.id,
      resolvedAt,
      handoffStatus: fresh.handoffStatus,
      resolvedBy: pickUser(fresh.assignedOperator, null),
    });
    return this.loadSingleView(fresh);
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

  private toView(
    session: ChatSession,
    lastMessage: ChatMessage | null,
    companyName: string | null,
  ): OperatorSessionView {
    const client = pickClient(session);
    return {
      id: session.id,
      type: session.type,
      title: session.title,
      updatedAt: session.updatedAt,
      participant: pickUser(client, companyName),
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
      assignedOperator: pickUser(session.assignedOperator, null),
    };
  }

  private async loadSingleView(session: ChatSession): Promise<OperatorSessionView> {
    const client = pickClient(session);
    const [lastMessage, companyName] = await Promise.all([
      this.messageRepository.findOne({
        where: { sessionId: session.id },
        order: { createdAt: 'DESC' },
      }),
      this.loadCompanyName(client?.id),
    ]);
    return this.toView(session, lastMessage, companyName);
  }

  private async loadCompanyName(userId: string | undefined): Promise<string | null> {
    if (!userId) return null;
    const questionnaire = await this.questionnaireRepository.findOne({
      where: { userId },
    });
    const raw = questionnaire?.answers?.companyName;
    if (typeof raw !== 'string') return null;
    const trimmed = raw.trim();
    return trimmed.length > 0 ? trimmed : null;
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
  companyName: string | null,
): {
  id: string;
  name: string;
  lastName: string;
  email: string;
  companyName: string | null;
} | null {
  if (!user) return null;
  return {
    id: user.id,
    name: user.name,
    lastName: user.lastName,
    email: user.email,
    companyName,
  };
}
