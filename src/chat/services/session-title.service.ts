import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AgentId } from '../../ai/enums/agent-id.enum';
import { DataClass } from '../../ai/enums/data-class.enum';
import { LlmTask } from '../../ai/enums/llm-task.enum';
import { LlmProxyService } from '../../ai/llm-proxy.service';
import { WebSocketGatewayService } from '../../websocket/websocket.gateway';
import { AI_SYSTEM_USER_ID } from '../chat.constants';
import { ChatSession } from '../entities/chat-session.entity';
import { ChatSessionParticipant } from '../entities/chat-session-participant.entity';

const TITLE_MAX_LENGTH = 60;
const TITLE_SYSTEM_PROMPT =
  'Ты — генератор заголовков для чат-сессий. Верни ровно короткий заголовок ' +
  'на русском языке в 3–6 слов, отражающий тему первого сообщения пользователя. ' +
  'Без кавычек, без точки в конце, без префиксов вроде «Тема:», только сам заголовок.';

@Injectable()
export class SessionTitleService {
  private readonly logger = new Logger(SessionTitleService.name);
  // De-dupe concurrent generation requests for the same session — msg1 and
  // msg2 arriving before the first LLM UPDATE would otherwise spawn two
  // parallel LLM calls; conditional UPDATE prevents wrong title from
  // winning at DB level, but this also avoids the extra LLM cost.
  private readonly inFlight = new Set<string>();

  constructor(
    @InjectRepository(ChatSession)
    private readonly sessionRepository: Repository<ChatSession>,
    @InjectRepository(ChatSessionParticipant)
    private readonly participantRepository: Repository<ChatSessionParticipant>,
    private readonly llm: LlmProxyService,
    private readonly wsGateway: WebSocketGatewayService,
  ) {}

  // Fire-and-forget from the two client-send paths. Generates a short AI
  // title from the very first client message, persists it, and pushes a
  // `chat:session_updated` WS event so open sidebars refresh without waiting
  // for the next full sessions refetch.
  async generateAndAssign(sessionId: string, firstMessageText: string): Promise<void> {
    const trimmed = firstMessageText.trim();
    if (!trimmed) return;
    if (this.inFlight.has(sessionId)) return;
    this.inFlight.add(sessionId);

    try {
      const response = await this.llm.chat({
        agentId: AgentId.Chatbot,
        task: LlmTask.Summarize,
        declaredDataClass: DataClass.RawPii,
        messages: [
          { role: 'system', content: TITLE_SYSTEM_PROMPT },
          { role: 'user', content: trimmed },
        ],
      });

      const title = this.sanitize(response.content);
      if (!title) return;

      // Conditional UPDATE — do not overwrite a title someone else already set
      // (concurrent race between sendPlatformMessage and streaming endpoints).
      const result = await this.sessionRepository
        .createQueryBuilder()
        .update(ChatSession)
        .set({ title })
        .where('id = :id', { id: sessionId })
        .andWhere('"title" IS NULL')
        .execute();
      if ((result.affected ?? 0) === 0) return;

      const participants = await this.participantRepository.find({
        where: { sessionId },
      });
      const payload = { sessionId, title };
      for (const p of participants) {
        if (p.userId === AI_SYSTEM_USER_ID) continue;
        this.wsGateway.emitToUser(p.userId, 'chat:session_updated', payload);
      }
    } catch (error) {
      this.logger.warn(
        `Failed to generate session title for ${sessionId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    } finally {
      this.inFlight.delete(sessionId);
    }
  }

  private sanitize(raw: string): string {
    let value = raw.trim();
    // LLM sometimes prefixes despite the system prompt (Тема:, Title:, etc).
    value = value.replace(/^(тема|title)\s*[:\-—]\s*/i, '').trim();
    // Strip surrounding quotes — ASCII + Unicode curly + guillemets + backtick.
    const quotes = '["\'«»“”„‘’`]+';
    value = value.replace(new RegExp(`^${quotes}|${quotes}$`, 'g'), '').trim();
    // Cut trailing period the LLM may still append.
    value = value.replace(/[.!?…]+$/, '').trim();
    value = value.replace(/\s+/g, ' ');
    if (!value) return '';
    if (value.length <= TITLE_MAX_LENGTH) return value;
    return `${value.slice(0, TITLE_MAX_LENGTH - 1).trimEnd()}…`;
  }
}
