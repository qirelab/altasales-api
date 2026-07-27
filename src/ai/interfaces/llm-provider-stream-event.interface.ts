import { LlmUsage } from './llm-usage.interface';

/**
 * Event emitted by an LLM provider's `streamChat`. `delta` events carry the
 * next chunk of assistant content as it arrives from the upstream model.
 * A single terminal `done` event carries the final usage metrics — the
 * accumulated content lives in the previously emitted deltas.
 */
export type LlmProviderStreamEvent =
  | { type: 'delta'; content: string }
  | { type: 'done'; usage: LlmUsage };
