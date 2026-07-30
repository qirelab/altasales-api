import { LlmChatResponse } from './llm-chat-response.interface';

/**
 * Public event surface for `LlmProxyStreamService.chatStream`.
 *
 * `delta` events carry the next chunk of assistant content — accumulate them
 * to reconstruct the final answer. The terminal `done` event carries the same
 * shape callers get from `LlmProxyService.chat`, so downstream code can log,
 * persist, or hand it to the monitoring pipeline with a single code path.
 */
export type LlmChatStreamEvent =
  | { type: 'delta'; content: string }
  | { type: 'done'; response: LlmChatResponse };
