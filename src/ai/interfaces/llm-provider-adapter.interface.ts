import { LlmMessage } from './llm-message.interface';
import { LlmProviderStreamEvent } from './llm-provider-stream-event.interface';
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
  // Optional streaming path. Providers that omit it are still callable via
  // `chat`; `LlmProxyService.chatStream` reports AI_STREAM_UNSUPPORTED when
  // the configured provider cannot stream.
  streamChat?(
    messages: LlmMessage[],
    options?: LlmProviderRequestOptions,
  ): AsyncIterable<LlmProviderStreamEvent>;
}
