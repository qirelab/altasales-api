import { Injectable } from '@nestjs/common';
import { LlmProvider } from '../enums/llm-provider.enum';
import {
  LlmProviderAdapter,
  LlmProviderResponse,
} from '../interfaces/llm-provider-adapter.interface';
import { LlmMessage } from '../interfaces/llm-message.interface';
import { LlmProviderStreamEvent } from '../interfaces/llm-provider-stream-event.interface';

const MOCK_CONTENT = 'Mock LLM response';

@Injectable()
export class MockLlmProvider implements LlmProviderAdapter {
  readonly providerId = LlmProvider.Mock;
  readonly modelId = 'mock-llm-v1';
  readonly providerRole = 'primary';
  readonly isExternal = false;

  async chat(messages: LlmMessage[]): Promise<LlmProviderResponse> {
    const startedAt = Date.now();

    return {
      content: MOCK_CONTENT,
      usage: {
        tokensIn: this.estimateTokens(
          messages.map((message) => message.content).join(' '),
        ),
        tokensOut: this.estimateTokens(MOCK_CONTENT),
        costRub: 0,
        latencyMs: Date.now() - startedAt,
      },
    };
  }

  async *streamChat(
    messages: LlmMessage[],
  ): AsyncIterable<LlmProviderStreamEvent> {
    const startedAt = Date.now();
    // Split into word-sized chunks so downstream tests can observe multiple
    // deltas without needing a real streaming provider.
    for (const chunk of MOCK_CONTENT.split(' ')) {
      yield { type: 'delta', content: chunk };
      yield { type: 'delta', content: ' ' };
    }
    yield {
      type: 'done',
      usage: {
        tokensIn: this.estimateTokens(
          messages.map((message) => message.content).join(' '),
        ),
        tokensOut: this.estimateTokens(MOCK_CONTENT),
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
