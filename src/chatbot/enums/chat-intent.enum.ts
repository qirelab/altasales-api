export enum ChatIntent {
  Greeting = 'greeting',
  Meta = 'meta',
  ExplicitHandoff = 'explicit_handoff',
  OffTopic = 'off_topic',
  PlatformQuestion = 'platform_question',
  SalesQuestion = 'sales_question',
}

export const CHAT_INTENT_VALUES: readonly ChatIntent[] = Object.freeze([
  ChatIntent.Greeting,
  ChatIntent.Meta,
  ChatIntent.ExplicitHandoff,
  ChatIntent.OffTopic,
  ChatIntent.PlatformQuestion,
  ChatIntent.SalesQuestion,
]);

export function parseChatIntent(raw: string): ChatIntent | null {
  const normalized = raw.trim().toLowerCase();
  const match = CHAT_INTENT_VALUES.find((value) => value === normalized);
  return match ?? null;
}
