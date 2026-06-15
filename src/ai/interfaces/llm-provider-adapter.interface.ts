import { LlmMessage } from './llm-message.interface';
import { LlmUsage } from './llm-usage.interface';

export interface LlmProviderResponse {
  content: string;
  usage: LlmUsage;
}

export interface LlmProviderRequestOptions {
  signal?: AbortSignal;
}

export interface LlmProviderAdapter {
  providerId: string;
  modelId: string;
  providerRole?: 'primary' | 'fallback';
  isExternal?: boolean;
  chat(
    messages: LlmMessage[],
    options?: LlmProviderRequestOptions,
  ): Promise<LlmProviderResponse>;
}
