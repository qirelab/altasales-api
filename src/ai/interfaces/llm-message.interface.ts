export interface LlmMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}
