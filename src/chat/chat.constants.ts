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
 * Sent by the platform on the very first open of a client's platform-type
 * conversation. The text is persisted as a real ChatMessage authored by the
 * AI system user, so the client sees it as a normal AI message with the
 * proper "AI-консультант" badge from the moment they open the chat.
 */
export const AI_WELCOME_MESSAGE =
  'Здравствуйте! Я AI-консультант AltaSales — помогу разобраться в ваших '
  + 'рекомендациях, объясню, почему вам подобрали именно эти услуги, и отвечу '
  + 'на вопросы про услуги, экспертов и работу платформы. Просто напишите, что '
  + 'вас интересует.';
