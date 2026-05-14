import { LlmMessage } from './llm-message.interface';
import { LlmUsage } from './llm-usage.interface';

export interface LlmProviderResponse {
  content: string;
  usage: LlmUsage;
}

export interface LlmProviderAdapter {
  providerId: string;
  modelId: string;
  isExternal?: boolean;
  chat(messages: LlmMessage[]): Promise<LlmProviderResponse>;
}
