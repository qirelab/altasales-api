import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Questionnaire } from '../../questionnaires/entities/questionnaire.entity';
import { User } from '../../users/entities/user.entity';
import { AI_SYSTEM_USER_ID } from '../chat.constants';
import { ChatService } from '../chat.service';
import { ChatHandoffStatus } from '../entities/chat-handoff-status.enum';
import { ChatMessage } from '../entities/chat-message.entity';
import { ChatParticipantRole } from '../entities/chat-participant-role.enum';
import { ChatSession } from '../entities/chat-session.entity';
import { ChatSessionParticipant } from '../entities/chat-session-participant.entity';
import { ChatSessionType } from '../entities/chat-session-type.enum';
import { HandoffService } from './handoff.service';

export type ExpertSessionFilter = 'all' | 'active' | 'resolved';

export type ExpertSessionView = {
  id: string;
  type: string;
  title: string | null;
  orderId: string | null;
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
  assignedExpertId: string | null;
  assignedExpert: {
    id: string;
    name: string;
    lastName: string;
    email: string;
    companyName: string | null;
  } | null;
};

const ACTIVE_STATUSES = [
  ChatHandoffStatus.Awaiting,
  ChatHandoffStatus.InProgress,
] as const;

@Injectable()
export class ExpertChatService {
  constructor(
    @InjectRepository(ChatSession)
    private readonly sessionRepository: Repository<ChatSession>,
    @InjectRepository(ChatMessage)
    private readonly messageRepository: Repository<ChatMessage>,
    @InjectRepository(Questionnaire)
    private readonly questionnaireRepository: Repository<Questionnaire>,
    private readonly handoffService: HandoffService,
    private readonly chatService: ChatService,
  ) {}

  async listExpertSessions(
    expertId: string,
    filter: ExpertSessionFilter,
  ): Promise<ExpertSessionView[]> {
    // Purchases made before the feature still need sessions.
    await this.chatService.ensureExpertSessionsForUser(expertId);

    const qb = this.sessionRepository
      .createQueryBuilder('s')
      .innerJoin(
        ChatSessionParticipant,
        'p',
        'p."sessionId" = s.id AND p."userId" = :expertId AND p.role = :expertRole',
        { expertId, expertRole: ChatParticipantRole.Expert },
      )
      .leftJoinAndSelect('s.participantOne', 'p1')
      .leftJoinAndSelect('s.participantTwo', 'p2')
      .leftJoinAndSelect('s.assignedOperator', 'assignee')
      .where('s.type = :type', { type: ChatSessionType.Expert })
      .orderBy('s.updatedAt', 'DESC')
      .take(200);

    if (filter === 'resolved') {
      qb.andWhere('s."handoffStatus" = :resolved', {
        resolved: ChatHandoffStatus.Resolved,
      });
    } else if (filter === 'active') {
      qb.andWhere('s."handoffStatus" IN (:...active)', {
        active: [...ACTIVE_STATUSES],
      });
    }
    // filter === 'all' → no handoffStatus constraint (all purchased-service chats)

    const rows = await qb.getMany();
    if (rows.length === 0) return [];

    const sessionIds = rows.map((r) => r.id);
    const clientIds = rows
      .map((r) => pickClient(r, expertId)?.id)
      .filter((id): id is string => Boolean(id));

    const lastMessages = await this.messageRepository
      .createQueryBuilder('m')
      .distinctOn(['m."sessionId"'])
      .where('m."sessionId" IN (:...ids)', { ids: sessionIds })
      .orderBy('m."sessionId"')
      .addOrderBy('m."createdAt"', 'DESC')
      .getMany();
    const lastMessageBySession = new Map<string, ChatMessage>();
    for (const m of lastMessages) lastMessageBySession.set(m.sessionId, m);

    const questionnaires =
      clientIds.length > 0
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

    return rows.map((row) =>
      this.toView(
        row,
        expertId,
        lastMessageBySession.get(row.id) ?? null,
        companyByUserId.get(pickClient(row, expertId)?.id ?? '') ?? null,
      ),
    );
  }

  async claim(expertId: string, sessionId: string): Promise<ExpertSessionView> {
    const session = await this.handoffService.claim({
      sessionId,
      assigneeId: expertId,
      expectedType: ChatSessionType.Expert,
      participantRole: ChatParticipantRole.Expert,
      roleLabel: 'expert',
    });
    return this.loadSingleView(session, expertId);
  }

  async resolve(
    expertId: string,
    sessionId: string,
  ): Promise<ExpertSessionView> {
    const session = await this.handoffService.resolve({
      sessionId,
      resolverId: expertId,
      expectedType: ChatSessionType.Expert,
      roleLabel: 'expert',
    });
    return this.loadSingleView(session, expertId);
  }

  private toView(
    session: ChatSession,
    expertId: string,
    lastMessage: ChatMessage | null,
    companyName: string | null,
  ): ExpertSessionView {
    const client = pickClient(session, expertId);
    return {
      id: session.id,
      type: session.type,
      title: session.title,
      orderId: session.orderId,
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
      assignedExpertId: session.assignedOperatorId,
      assignedExpert: pickUser(session.assignedOperator, null),
    };
  }

  private async loadSingleView(
    session: ChatSession,
    expertId: string,
  ): Promise<ExpertSessionView> {
    const client = pickClient(session, expertId);
    const [lastMessage, companyName] = await Promise.all([
      this.messageRepository.findOne({
        where: { sessionId: session.id },
        order: { createdAt: 'DESC' },
      }),
      this.loadCompanyName(client?.id),
    ]);
    return this.toView(session, expertId, lastMessage, companyName);
  }

  private async loadCompanyName(
    userId: string | undefined,
  ): Promise<string | null> {
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

function pickClient(session: ChatSession, expertId: string): User | null {
  if (
    session.participantOne &&
    session.participantOne.id !== AI_SYSTEM_USER_ID &&
    session.participantOne.id !== expertId
  ) {
    return session.participantOne;
  }
  if (
    session.participantTwo &&
    session.participantTwo.id !== AI_SYSTEM_USER_ID &&
    session.participantTwo.id !== expertId
  ) {
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
