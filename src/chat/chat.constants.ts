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
 * Sent by the AI when a handoff to a live operator is triggered by an
 * explicit user request. Persisted as an AI-authored ChatMessage so the
 * client sees a natural continuation of the thread while the operator is
 * being paged.
 */
export const HANDOFF_ANNOUNCE_MESSAGE =
  'Соединяю вас со специалистом. Менеджер ответит в ближайшее время.';
