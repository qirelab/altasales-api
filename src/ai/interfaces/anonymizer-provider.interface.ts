import { LlmMessage } from './llm-message.interface';

export interface AnonymizerProviderRequest {
  messages: LlmMessage[];
}

export interface AnonymizerProvider {
  anonymize(request: AnonymizerProviderRequest): Promise<string>;
}
