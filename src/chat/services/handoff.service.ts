import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DataSource, Not, Repository } from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { WebSocketGatewayService } from '../../websocket/websocket.gateway';
import {
  AI_SYSTEM_USER_ID,
  HANDOFF_TIMEOUT_RESUME_MESSAGE,
} from '../chat.constants';
import { ChatHandoffStatus } from '../entities/chat-handoff-status.enum';
import { ChatMessage } from '../entities/chat-message.entity';
import { ChatParticipantRole } from '../entities/chat-participant-role.enum';
import { ChatSession } from '../entities/chat-session.entity';
import { ChatSessionParticipant } from '../entities/chat-session-participant.entity';
import { ChatSessionType } from '../entities/chat-session-type.enum';

export type HandoffClaimRole = 'operator' | 'expert';

const DEFAULT_HANDOFF_TIMEOUT_MS = 15 * 60 * 1000;

@Injectable()
export class HandoffService {
  private readonly logger = new Logger(HandoffService.name);

  constructor(
    @InjectRepository(ChatSession)
    private readonly sessionRepository: Repository<ChatSession>,
    @InjectRepository(ChatSessionParticipant)
    private readonly participantRepository: Repository<ChatSessionParticipant>,
    @InjectRepository(ChatMessage)
    private readonly messageRepository: Repository<ChatMessage>,
    private readonly dataSource: DataSource,
    private readonly wsGateway: WebSocketGatewayService,
    private readonly configService: ConfigService,
  ) {}

  isAiPausedByHandoff(session: Pick<ChatSession, 'handoffStatus'>): boolean {
    return (
      session.handoffStatus === ChatHandoffStatus.Awaiting ||
      session.handoffStatus === ChatHandoffStatus.InProgress
    );
  }

  async claim(params: {
    sessionId: string;
    assigneeId: string;
    expectedType: ChatSessionType;
    participantRole: ChatParticipantRole;
    roleLabel: HandoffClaimRole;
  }): Promise<ChatSession> {
    const session = await this.loadSession(
      params.sessionId,
      params.expectedType,
    );

    if (params.expectedType === ChatSessionType.Expert) {
      await this.assertExpertParticipant(params.sessionId, params.assigneeId);
    }

    if (session.handoffStatus === ChatHandoffStatus.InProgress) {
      if (session.assignedOperatorId === params.assigneeId) {
        return session;
      }
      throw new ConflictException(
        params.roleLabel === 'expert'
          ? 'Session is already being handled by another expert'
          : 'Session is already being handled by another operator',
      );
    }
    if (session.handoffStatus !== ChatHandoffStatus.Awaiting) {
      throw new BadRequestException(
        params.roleLabel === 'expert'
          ? 'Only sessions awaiting an expert can be claimed'
          : 'Only sessions awaiting an operator can be claimed',
      );
    }

    const claimedAt = new Date();
    await this.dataSource.transaction(async (manager) => {
      const result = await manager
        .createQueryBuilder()
        .update(ChatSession)
        .set({
          handoffStatus: ChatHandoffStatus.InProgress,
          assignedOperatorId: params.assigneeId,
          handoffClaimedAt: claimedAt,
          updatedAt: claimedAt,
        })
        .where('id = :id', { id: params.sessionId })
        .andWhere('"handoffStatus" = :awaiting', {
          awaiting: ChatHandoffStatus.Awaiting,
        })
        .execute();
      if ((result.affected ?? 0) === 0) {
        throw new ConflictException(
          params.roleLabel === 'expert'
            ? 'Session was claimed by another expert moments ago'
            : 'Session was claimed by another operator moments ago',
        );
      }

      const existing = await manager
        .getRepository(ChatSessionParticipant)
        .findOne({
          where: { sessionId: params.sessionId, userId: params.assigneeId },
        });
      if (!existing) {
        await manager.getRepository(ChatSessionParticipant).save(
          manager.getRepository(ChatSessionParticipant).create({
            sessionId: params.sessionId,
            userId: params.assigneeId,
            role: params.participantRole,
          }),
        );
      }
    });

    const fresh = await this.loadSession(params.sessionId, params.expectedType);
    await this.postClaimAnnouncement(fresh, claimedAt, params.roleLabel);
    this.broadcast(fresh, params.assigneeId, 'chat:handoff_claimed', {
      sessionId: fresh.id,
      operatorId: params.assigneeId,
      expertId: params.roleLabel === 'expert' ? params.assigneeId : undefined,
      operator: pickAssignee(fresh.assignedOperator),
      claimedAt,
      handoffStatus: fresh.handoffStatus,
    });
    return fresh;
  }

  /**
   * Expert started writing: put the session into `in_progress`, assign the
   * expert, pause AI until explicit resolve.
   *
   * - `awaiting` → claim (AI handoff path)
   * - `null` / `resolved` → voluntary takeover (expert jumped into a quiet chat)
   * - already `in_progress` for this expert → no-op
   *
   * Never auto-resolves — expert must call resolve ("Разрешить") to return AI.
   */
  async ensureExpertActiveOnReply(
    sessionId: string,
    expertId: string,
  ): Promise<'claimed' | 'activated' | 'noop'> {
    const session = await this.sessionRepository.findOne({
      where: { id: sessionId, type: ChatSessionType.Expert },
      relations: ['assignedOperator'],
    });
    if (!session) {
      throw new NotFoundException('Expert session not found');
    }

    if (session.handoffStatus === ChatHandoffStatus.InProgress) {
      if (session.assignedOperatorId === expertId) {
        return 'noop';
      }
      throw new ConflictException(
        'Session is already being handled by another expert',
      );
    }

    if (session.handoffStatus === ChatHandoffStatus.Awaiting) {
      const claimed = await this.autoClaimOnExpertReply(sessionId, expertId);
      return claimed ? 'claimed' : 'noop';
    }

    // null or resolved — expert voluntarily enters the chat.
    const claimedAt = new Date();
    const result = await this.sessionRepository
      .createQueryBuilder()
      .update(ChatSession)
      .set({
        handoffStatus: ChatHandoffStatus.InProgress,
        assignedOperatorId: expertId,
        handoffClaimedAt: claimedAt,
        // No AI-requested handoff — keep requestedAt null so the 15m timeout
        // job (which requires handoffRequestedAt) does not auto-resume AI
        // while the expert is actively working.
        handoffRequestedAt: null,
        handoffResolvedAt: null,
        needsHumanHandoff: true,
        handoffTrigger: null,
        updatedAt: claimedAt,
      })
      .where('id = :id', { id: sessionId })
      .andWhere('type = :type', { type: ChatSessionType.Expert })
      .andWhere('("handoffStatus" IS NULL OR "handoffStatus" = :resolved)', {
        resolved: ChatHandoffStatus.Resolved,
      })
      .execute();
    if ((result.affected ?? 0) === 0) {
      return 'noop';
    }

    const fresh = await this.loadSession(sessionId, ChatSessionType.Expert);
    await this.postClaimAnnouncement(fresh, claimedAt, 'expert');
    this.broadcast(fresh, expertId, 'chat:handoff_claimed', {
      sessionId: fresh.id,
      operatorId: expertId,
      expertId,
      operator: pickAssignee(fresh.assignedOperator),
      claimedAt,
      handoffStatus: fresh.handoffStatus,
    });
    return 'activated';
  }

  /**
   * First human (expert) reply while awaiting: race-safe auto-claim to
   * in_progress so AI stays paused until explicit resolve. Platform keeps
   * legacy auto-resolve on human reply (handled by caller).
   */
  async autoClaimOnExpertReply(
    sessionId: string,
    expertId: string,
  ): Promise<boolean> {
    const claimedAt = new Date();
    const result = await this.sessionRepository
      .createQueryBuilder()
      .update(ChatSession)
      .set({
        handoffStatus: ChatHandoffStatus.InProgress,
        assignedOperatorId: expertId,
        handoffClaimedAt: claimedAt,
        needsHumanHandoff: true,
        updatedAt: claimedAt,
      })
      .where('id = :id', { id: sessionId })
      .andWhere('type = :type', { type: ChatSessionType.Expert })
      .andWhere('"handoffStatus" = :awaiting', {
        awaiting: ChatHandoffStatus.Awaiting,
      })
      .execute();
    if ((result.affected ?? 0) === 0) {
      return false;
    }
    const fresh = await this.loadSession(sessionId, ChatSessionType.Expert);
    await this.postClaimAnnouncement(fresh, claimedAt, 'expert');
    this.broadcast(fresh, expertId, 'chat:handoff_claimed', {
      sessionId: fresh.id,
      operatorId: expertId,
      expertId,
      operator: pickAssignee(fresh.assignedOperator),
      claimedAt,
      handoffStatus: fresh.handoffStatus,
    });
    return true;
  }

  async resolve(params: {
    sessionId: string;
    resolverId: string;
    expectedType: ChatSessionType;
    roleLabel: HandoffClaimRole;
  }): Promise<ChatSession> {
    const session = await this.loadSession(
      params.sessionId,
      params.expectedType,
    );

    if (params.expectedType === ChatSessionType.Expert) {
      await this.assertExpertParticipant(params.sessionId, params.resolverId);
    }

    if (session.handoffStatus !== ChatHandoffStatus.InProgress) {
      throw new BadRequestException(
        'Only sessions in progress can be resolved',
      );
    }
    if (
      session.assignedOperatorId &&
      session.assignedOperatorId !== params.resolverId
    ) {
      throw new ForbiddenException(
        params.roleLabel === 'expert'
          ? 'This session is assigned to another expert'
          : 'This session is assigned to another operator',
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
      .where('id = :id', { id: params.sessionId })
      .andWhere('"handoffStatus" = :inProgress', {
        inProgress: ChatHandoffStatus.InProgress,
      })
      .execute();
    if ((result.affected ?? 0) === 0) {
      throw new ConflictException(
        'Session was resolved or re-assigned moments ago',
      );
    }

    const fresh = await this.loadSession(params.sessionId, params.expectedType);
    await this.postResolveAnnouncement(fresh, resolvedAt, params.roleLabel);
    this.broadcast(fresh, params.resolverId, 'chat:handoff_resolved', {
      sessionId: fresh.id,
      resolvedAt,
      handoffStatus: fresh.handoffStatus,
      resolvedBy: pickAssignee(fresh.assignedOperator),
    });
    return fresh;
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async resumeTimedOutHandoffs(): Promise<number> {
    const timeoutMs = this.getTimeoutMs();
    const cutoff = new Date(Date.now() - timeoutMs);

    const candidates = await this.sessionRepository
      .createQueryBuilder('s')
      .where('s."handoffStatus" IN (:...statuses)', {
        statuses: [ChatHandoffStatus.Awaiting, ChatHandoffStatus.InProgress],
      })
      .andWhere('s."handoffRequestedAt" IS NOT NULL')
      .andWhere('s."handoffRequestedAt" <= :cutoff', { cutoff })
      .take(100)
      .getMany();

    let resumed = 0;
    for (const session of candidates) {
      const didResume = await this.tryResumeTimedOutSession(session);
      if (didResume) resumed += 1;
    }
    if (resumed > 0) {
      this.logger.log({
        eventName: 'CHAT_HANDOFF_TIMEOUT_RESUMED',
        count: resumed,
        timeoutMs,
      });
    }
    return resumed;
  }

  private async tryResumeTimedOutSession(
    session: ChatSession,
  ): Promise<boolean> {
    if (!session.handoffRequestedAt) return false;

    const humanReply = await this.messageRepository
      .createQueryBuilder('m')
      .where('m."sessionId" = :sessionId', { sessionId: session.id })
      .andWhere('m."isAiGenerated" = false')
      .andWhere('m."senderId" != :aiId', { aiId: AI_SYSTEM_USER_ID })
      .andWhere('m."createdAt" > :requestedAt', {
        requestedAt: session.handoffRequestedAt,
      })
      .getOne();
    if (humanReply) {
      return false;
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
      .where('id = :id', { id: session.id })
      .andWhere('"handoffStatus" IN (:...statuses)', {
        statuses: [ChatHandoffStatus.Awaiting, ChatHandoffStatus.InProgress],
      })
      .andWhere('"handoffRequestedAt" = :requestedAt', {
        requestedAt: session.handoffRequestedAt,
      })
      .execute();
    if ((result.affected ?? 0) === 0) {
      return false;
    }

    const announcement = this.messageRepository.create({
      sessionId: session.id,
      senderId: AI_SYSTEM_USER_ID,
      text: HANDOFF_TIMEOUT_RESUME_MESSAGE,
      isAiGenerated: true,
      createdAt: resolvedAt,
    });
    const saved = await this.messageRepository.save(announcement);
    await this.sessionRepository.update(session.id, {
      updatedAt: saved.createdAt,
    });

    const fresh = await this.sessionRepository.findOne({
      where: { id: session.id },
      relations: ['assignedOperator'],
    });
    if (!fresh) return true;

    const participants = await this.participantRepository.find({
      where: { sessionId: session.id },
    });
    const messagePayload = {
      message: { ...saved, files: [] },
      session: {
        id: session.id,
        updatedAt: saved.createdAt,
        title: fresh.title,
      },
    };
    const handoffPayload = {
      sessionId: session.id,
      resolvedAt,
      handoffStatus: ChatHandoffStatus.Resolved,
      resolvedBy: null,
      reason: 'timeout',
    };
    for (const p of participants) {
      if (p.userId === AI_SYSTEM_USER_ID) continue;
      this.wsGateway.emitToUser(p.userId, 'chat:new_message', messagePayload);
      this.wsGateway.emitToUser(
        p.userId,
        'chat:handoff_resolved',
        handoffPayload,
      );
    }
    return true;
  }

  private getTimeoutMs(): number {
    const raw = this.configService.get<string>('CHAT_HANDOFF_TIMEOUT_MS');
    const parsed = raw ? Number(raw) : NaN;
    return Number.isFinite(parsed) && parsed > 0
      ? parsed
      : DEFAULT_HANDOFF_TIMEOUT_MS;
  }

  private async loadSession(
    sessionId: string,
    expectedType: ChatSessionType,
  ): Promise<ChatSession> {
    const session = await this.sessionRepository.findOne({
      where: { id: sessionId, type: expectedType },
      relations: ['participantOne', 'participantTwo', 'assignedOperator'],
    });
    if (!session) {
      throw new NotFoundException(
        expectedType === ChatSessionType.Expert
          ? 'Expert session not found'
          : 'Platform session not found',
      );
    }
    return session;
  }

  private async assertExpertParticipant(
    sessionId: string,
    userId: string,
  ): Promise<void> {
    const membership = await this.participantRepository.findOne({
      where: {
        sessionId,
        userId,
        role: ChatParticipantRole.Expert,
      },
    });
    if (!membership) {
      throw new ForbiddenException(
        'You are not the expert participant of this session',
      );
    }
  }

  private async postClaimAnnouncement(
    session: ChatSession,
    claimedAt: Date,
    roleLabel: HandoffClaimRole,
  ): Promise<void> {
    const assignee = session.assignedOperator;
    if (!assignee) return;
    const fullName = formatAssigneeName(assignee);
    const text =
      roleLabel === 'expert'
        ? `К чату подключился эксперт ${fullName}. Дальше вам ответит он в этом же чате.`
        : `К чату подключился оператор ${fullName}. Дальше вам ответит он в этом же чате.`;
    await this.postSystemAnnouncement(session, claimedAt, text);
  }

  private async postResolveAnnouncement(
    session: ChatSession,
    resolvedAt: Date,
    roleLabel: HandoffClaimRole,
  ): Promise<void> {
    const assignee = session.assignedOperator;
    const fullName = formatAssigneeName(assignee);
    const text =
      roleLabel === 'expert'
        ? `Эксперт ${fullName} покинул чат. Дальше вам снова отвечает AI-консультант.`
        : `Оператор ${fullName} покинул чат. Дальше вам снова отвечает AI-консультант.`;
    await this.postSystemAnnouncement(session, resolvedAt, text);
  }

  private async postSystemAnnouncement(
    session: ChatSession,
    at: Date,
    text: string,
  ): Promise<void> {
    const announcement = this.messageRepository.create({
      sessionId: session.id,
      senderId: AI_SYSTEM_USER_ID,
      text,
      isAiGenerated: true,
      createdAt: at,
    });
    const saved = await this.messageRepository.save(announcement);
    await this.sessionRepository.update(session.id, {
      updatedAt: saved.createdAt,
    });
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
      if (p.userId === AI_SYSTEM_USER_ID) continue;
      this.wsGateway.emitToUser(p.userId, 'chat:new_message', payload);
    }
  }

  private broadcast(
    session: ChatSession,
    initiatorId: string,
    event: string,
    payload: Record<string, unknown>,
  ): void {
    void this.participantRepository
      .find({
        where: { sessionId: session.id, userId: Not(initiatorId) },
      })
      .then((participants) => {
        for (const participant of participants) {
          if (participant.userId === AI_SYSTEM_USER_ID) continue;
          this.wsGateway.emitToUser(participant.userId, event, payload);
        }
        this.wsGateway.emitToUser(initiatorId, event, payload);
      });
    this.logger.log({
      eventName: 'CHAT_HANDOFF_EVENT',
      event,
      sessionId: session.id,
      status: session.handoffStatus,
    });
  }
}

function pickAssignee(user: User | null | undefined): {
  id: string;
  name: string;
  lastName: string;
  email: string;
} | null {
  if (!user) return null;
  return {
    id: user.id,
    name: user.name,
    lastName: user.lastName,
    email: user.email,
  };
}

function formatAssigneeName(user: User | null | undefined): string {
  if (!user) return 'AltaSales';
  const parts = [user.name, user.lastName].filter((part) =>
    Boolean(part && part.trim().length > 0),
  );
  return parts.join(' ').trim() || 'AltaSales';
}
