import { LlmProviderAdapter } from '../interfaces/llm-provider-adapter.interface';

export const LLM_PROVIDER_ADAPTERS = Symbol('LLM_PROVIDER_ADAPTERS');
export const PRIMARY_OPENAI_COMPATIBLE_CHAT_PROVIDER = Symbol(
  'PRIMARY_OPENAI_COMPATIBLE_CHAT_PROVIDER',
);
export const FALLBACK_OPENAI_COMPATIBLE_CHAT_PROVIDER = Symbol(
  'FALLBACK_OPENAI_COMPATIBLE_CHAT_PROVIDER',
);

export type LlmProviderRegistry = LlmProviderAdapter[];
