import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Questionnaire } from '../../questionnaires/entities/questionnaire.entity';
import { User } from '../../users/entities/user.entity';
import { AI_SYSTEM_USER_ID } from '../chat.constants';
import { ChatHandoffStatus } from '../entities/chat-handoff-status.enum';
import { ChatMessage } from '../entities/chat-message.entity';
import { ChatParticipantRole } from '../entities/chat-participant-role.enum';
import { ChatSession } from '../entities/chat-session.entity';
import { ChatSessionType } from '../entities/chat-session-type.enum';
import { HandoffService } from './handoff.service';

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
    companyName: string | null;
  } | null;
};

const ACTIVE_STATUSES = [
  ChatHandoffStatus.Awaiting,
  ChatHandoffStatus.InProgress,
] as const;

@Injectable()
export class AdminChatService {
  constructor(
    @InjectRepository(ChatSession)
    private readonly sessionRepository: Repository<ChatSession>,
    @InjectRepository(ChatMessage)
    private readonly messageRepository: Repository<ChatMessage>,
    @InjectRepository(Questionnaire)
    private readonly questionnaireRepository: Repository<Questionnaire>,
    private readonly handoffService: HandoffService,
  ) {}

  async listOperatorSessions(
    filter: OperatorSessionFilter,
  ): Promise<OperatorSessionView[]> {
    let where: {
      type: ChatSessionType;
      handoffStatus: ChatHandoffStatus | ReturnType<typeof In>;
    };
    if (filter === 'resolved') {
      where = {
        type: ChatSessionType.Platform,
        handoffStatus: ChatHandoffStatus.Resolved,
      };
    } else {
      where = {
        type: ChatSessionType.Platform,
        handoffStatus: In(ACTIVE_STATUSES as unknown as ChatHandoffStatus[]),
      };
    }
    const rows = await this.sessionRepository.find({
      where,
      relations: ['participantOne', 'participantTwo', 'assignedOperator'],
      order: { updatedAt: 'DESC' },
      take: 200,
    });
    if (rows.length === 0) return [];

    const sessionIds = rows.map((r) => r.id);
    const clientIds = rows
      .map((r) => pickClient(r)?.id)
      .filter((id): id is string => Boolean(id));

    let lastMessages: ChatMessage[] = [];
    if (sessionIds.length > 0) {
      lastMessages = await this.messageRepository
        .createQueryBuilder('m')
        .distinctOn(['m."sessionId"'])
        .where('m."sessionId" IN (:...ids)', { ids: sessionIds })
        .orderBy('m."sessionId"')
        .addOrderBy('m."createdAt"', 'DESC')
        .getMany();
    }
    const lastMessageBySession = new Map<string, ChatMessage>();
    for (const m of lastMessages) lastMessageBySession.set(m.sessionId, m);

    let questionnaires: Questionnaire[] = [];
    if (clientIds.length > 0) {
      questionnaires = await this.questionnaireRepository.find({
        where: { userId: In(clientIds) },
      });
    }
    const companyByUserId = new Map<string, string | null>();
    for (const q of questionnaires) {
      const raw = q.answers?.companyName;
      const trimmed = typeof raw === 'string' ? raw.trim() : '';
      companyByUserId.set(q.userId, trimmed.length > 0 ? trimmed : null);
    }

    return rows.map((row) =>
      this.toView(
        row,
        lastMessageBySession.get(row.id) ?? null,
        companyByUserId.get(pickClient(row)?.id ?? '') ?? null,
      ),
    );
  }

  async claim(
    operatorId: string,
    sessionId: string,
  ): Promise<OperatorSessionView> {
    const session = await this.handoffService.claim({
      sessionId,
      assigneeId: operatorId,
      expectedType: ChatSessionType.Platform,
      participantRole: ChatParticipantRole.Operator,
      roleLabel: 'operator',
    });
    return this.loadSingleView(session);
  }

  async resolve(
    operatorId: string,
    sessionId: string,
  ): Promise<OperatorSessionView> {
    const session = await this.handoffService.resolve({
      sessionId,
      resolverId: operatorId,
      expectedType: ChatSessionType.Platform,
      roleLabel: 'operator',
    });
    return this.loadSingleView(session);
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
      lastMessage: pickLastMessage(lastMessage),
      needsHumanHandoff: session.needsHumanHandoff,
      handoffStatus: session.handoffStatus,
      handoffRequestedAt: session.handoffRequestedAt,
      handoffClaimedAt: session.handoffClaimedAt,
      handoffResolvedAt: session.handoffResolvedAt,
      assignedOperatorId: session.assignedOperatorId,
      assignedOperator: pickUser(session.assignedOperator, null),
    };
  }

  private async loadSingleView(
    session: ChatSession,
  ): Promise<OperatorSessionView> {
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

function pickClient(session: ChatSession): User | null {
  if (
    session.participantOne &&
    session.participantOne.id !== AI_SYSTEM_USER_ID
  ) {
    return session.participantOne;
  }
  if (
    session.participantTwo &&
    session.participantTwo.id !== AI_SYSTEM_USER_ID
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

function pickLastMessage(lastMessage: ChatMessage | null): {
  id: string;
  text: string;
  senderId: string;
  isAiGenerated: boolean;
  createdAt: Date;
} | null {
  if (!lastMessage) return null;
  return {
    id: lastMessage.id,
    text: lastMessage.text,
    senderId: lastMessage.senderId,
    isAiGenerated: lastMessage.isAiGenerated,
    createdAt: lastMessage.createdAt,
  };
}
