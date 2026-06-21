import { Injectable } from '@nestjs/common';
import { LlmProvider } from '../enums/llm-provider.enum';
import {
  LlmProviderAdapter,
  LlmProviderResponse,
} from '../interfaces/llm-provider-adapter.interface';
import { LlmMessage } from '../interfaces/llm-message.interface';

@Injectable()
export class MockLlmProvider implements LlmProviderAdapter {
  readonly providerId = LlmProvider.Mock;
  readonly modelId = 'mock-llm-v1';
  readonly providerRole = 'primary';
  readonly isExternal = false;

  async chat(messages: LlmMessage[]): Promise<LlmProviderResponse> {
    const startedAt = Date.now();
    const content = 'Mock LLM response';

    return {
      content,
      usage: {
        tokensIn: this.estimateTokens(
          messages.map((message) => message.content).join(' '),
        ),
        tokensOut: this.estimateTokens(content),
        costRub: 0,
        latencyMs: Date.now() - startedAt,
      },
    };
  }

  private estimateTokens(text: string): number {
    const words = text.trim().split(/\s+/).filter(Boolean).length;
    return Math.max(1, words);
  }
}
