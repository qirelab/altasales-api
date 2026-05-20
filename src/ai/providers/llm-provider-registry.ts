import { LlmProviderAdapter } from '../interfaces/llm-provider-adapter.interface';

export const LLM_PROVIDER_ADAPTERS = Symbol('LLM_PROVIDER_ADAPTERS');

export type LlmProviderRegistry = LlmProviderAdapter[];
