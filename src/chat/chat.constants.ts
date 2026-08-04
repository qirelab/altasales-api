import { ChatHandoffTrigger } from './entities/chat-handoff-trigger.enum';

/**
 * Fixed UUID for the virtual "AI-консультант AltaSales" user that answers
 * clients inside platform-type chat conversations. The row is seeded once by
 * a migration and referenced everywhere by this constant, so we never depend
 * on env vars for the identity of the AI author.
 */
export const AI_SYSTEM_USER_ID = '00000000-0000-0000-0000-00000000a1a1';

export const AI_SYSTEM_USER_EMAIL = 'ai@altasales.internal';

export const AI_SYSTEM_USER_NAME = 'AI-консультант AltaSales';

/**
 * Soft AI-authored handoff lines persisted as normal ChatMessages
 * (`senderId=AI`, `isAiGenerated=true`). Backend owns this copy — the LLM
 * is forbidden from inventing handoff phrases itself.
 */
export const HANDOFF_ANNOUNCE_BY_TRIGGER: Record<ChatHandoffTrigger, string> = {
  [ChatHandoffTrigger.UserExplicitRequest]: [
    'Конечно, сейчас подключу к вам живого специалиста.',
    'Обычно это занимает несколько минут - он продолжит разговор в этом же чате.',
  ].join(' '),
  [ChatHandoffTrigger.RagNoContext]: [
    'Здесь мне лучше не гадать, чтобы не подвести вас с ответом.',
    'Уже зову специалиста - он подключится к этому чату и разберёт вопрос подробно.',
  ].join(' '),
  [ChatHandoffTrigger.RagInfraError]: [
    'Что-то пошло не так на моей стороне, ответ не сформировался.',
    'Попробуйте задать вопрос ещё раз через минуту.',
    'Если проблема повторится, подключу специалиста.',
  ].join(' '),
};

/**
 * Explicit-request announce used by the keyword short-circuit in the
 * orchestrator (same voice as the RAG `explicit_handoff` path).
 */
export const HANDOFF_ANNOUNCE_MESSAGE =
  HANDOFF_ANNOUNCE_BY_TRIGGER[ChatHandoffTrigger.UserExplicitRequest];

export const HANDOFF_NO_CONTEXT_MESSAGE =
  HANDOFF_ANNOUNCE_BY_TRIGGER[ChatHandoffTrigger.RagNoContext];

export const HANDOFF_INFRA_ERROR_MESSAGE =
  HANDOFF_ANNOUNCE_BY_TRIGGER[ChatHandoffTrigger.RagInfraError];

export function formatParticipantDisplayName(
  person:
    | {
        name?: string | null;
        lastName?: string | null;
      }
    | null
    | undefined,
): string {
  if (!person) return 'специалист AltaSales';
  const parts = [person.name, person.lastName]
    .filter((part): part is string => Boolean(part && part.trim().length > 0))
    .map((part) => part.trim());
  return parts.join(' ').trim() || 'специалист AltaSales';
}

/** AI message posted when an operator claims the handoff. */
export function formatOperatorJoinedAnnouncement(fullName: string): string {
  return [
    `Оператор ${fullName} принял ваш запрос.`,
    'Дальше в этом чате вам ответит он.',
  ].join(' ');
}

/**
 * AI message posted when the operator explicitly resolves the handoff
 * and control returns to the AI consultant.
 */
export function formatHandoffResolvedAnnouncement(fullName: string): string {
  return [
    `Оператор ${fullName} завершил консультацию.`,
    'Я снова на связи и могу продолжить.',
  ].join(' ');
}
