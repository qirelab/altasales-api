import { Injectable } from '@nestjs/common';
import { AiError, normalizeProviderError } from '../errors/ai-error';
import { LlmProvider } from '../enums/llm-provider.enum';
import {
  LlmProviderAdapter,
  LlmProviderRequestOptions,
  LlmProviderResponse,
} from '../interfaces/llm-provider-adapter.interface';
import { LlmMessage } from '../interfaces/llm-message.interface';
import { LlmProviderStreamEvent } from '../interfaces/llm-provider-stream-event.interface';

const DEFAULT_CHAT_MODEL_ALIAS = 'chat-default';
const DEFAULT_FALLBACK_CHAT_MODEL_ALIAS = 'chat-fallback';

type OpenAICompatibleProviderRole = 'primary' | 'fallback';

type OpenAICompatibleChatResponse = {
  choices?: Array<{
    message?: {
      content?: unknown;
    };
  }>;
  usage?: {
    prompt_tokens?: unknown;
    completion_tokens?: unknown;
  };
};

type OpenAICompatibleStreamChunk = {
  choices?: Array<{
    delta?: {
      content?: unknown;
    };
  }>;
  usage?: {
    prompt_tokens?: unknown;
    completion_tokens?: unknown;
  };
};

@Injectable()
export class OpenAICompatibleChatProviderAdapter implements LlmProviderAdapter {
  constructor(
    private readonly role: OpenAICompatibleProviderRole = 'primary',
  ) {}

  readonly providerId = LlmProvider.OpenAICompatible;

  get providerRole(): OpenAICompatibleProviderRole {
    return this.role;
  }

  get modelId(): string {
    if (this.role === 'fallback') {
      return (
        process.env.LLM_FALLBACK_MODEL_ALIAS ||
        DEFAULT_FALLBACK_CHAT_MODEL_ALIAS
      );
    }

    return process.env.LLM_PRIMARY_MODEL_ALIAS || DEFAULT_CHAT_MODEL_ALIAS;
  }

  readonly isExternal = true;

  async chat(
    messages: LlmMessage[],
    options?: LlmProviderRequestOptions,
  ): Promise<LlmProviderResponse> {
    const startedAt = Date.now();
    const config = this.getConfig();

    const response = await fetch(`${config.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: config.model,
        messages,
      }),
      signal: options?.signal,
    });

    if (!response.ok) {
      throw normalizeProviderError({ status: response.status });
    }

    const body = (await response.json()) as OpenAICompatibleChatResponse;
    const content = body.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || content.length === 0) {
      throw this.safeProviderUnavailableError(false);
    }

    return {
      content,
      usage: {
        tokensIn: this.safeNumber(body.usage?.prompt_tokens),
        tokensOut: this.safeNumber(body.usage?.completion_tokens),
        costRub: 0,
        latencyMs: Date.now() - startedAt,
      },
    };
  }

  async *streamChat(
    messages: LlmMessage[],
    options?: LlmProviderRequestOptions,
  ): AsyncIterable<LlmProviderStreamEvent> {
    const startedAt = Date.now();
    const config = this.getConfig();

    const response = await fetch(`${config.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
      body: JSON.stringify({
        model: config.model,
        messages,
        stream: true,
        stream_options: { include_usage: true },
      }),
      signal: options?.signal,
    });

    if (!response.ok) {
      throw normalizeProviderError({ status: response.status });
    }

    const body = response.body;
    if (!body) {
      throw this.safeProviderUnavailableError(false);
    }

    let tokensIn = 0;
    let tokensOut = 0;
    let anyContent = false;
    const decoder = new TextDecoder();
    const reader = body.getReader();
    let buffer = '';
    try {

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let separatorIndex = buffer.indexOf('\n\n');
        while (separatorIndex !== -1) {
          const frame = buffer.slice(0, separatorIndex);
          buffer = buffer.slice(separatorIndex + 2);
          const parsed = this.parseFrame(frame);
          if (parsed === 'DONE') {
            // Upstream sent the terminal marker; stop reading further.
            buffer = '';
            break;
          }
          if (parsed) {
            const content = this.pickChunkContent(parsed);
            if (content) {
              anyContent = true;
              yield { type: 'delta', content };
            }
            tokensIn = this.safeNumber(parsed.usage?.prompt_tokens) || tokensIn;
            tokensOut =
              this.safeNumber(parsed.usage?.completion_tokens) || tokensOut;
          }
          separatorIndex = buffer.indexOf('\n\n');
        }
      }
    } finally {
      // Free the underlying stream even if the consumer aborts mid-loop.
      try {
        reader.releaseLock();
      } catch {
        // Ignore release errors — the reader may already be closed.
      }
    }

    if (!anyContent) {
      throw this.safeProviderUnavailableError(false);
    }

    yield {
      type: 'done',
      usage: {
        tokensIn,
        tokensOut,
        costRub: 0,
        latencyMs: Date.now() - startedAt,
      },
    };
  }

  private parseFrame(frame: string): OpenAICompatibleStreamChunk | 'DONE' | undefined {
    // SSE frame contains `data: <payload>` lines (plus optional event/id/retry).
    // We only care about the joined data payload.
    const dataLines: string[] = [];
    for (const rawLine of frame.split('\n')) {
      const line = rawLine.trimEnd();
      if (!line || !line.startsWith('data:')) continue;
      dataLines.push(line.slice(5).replace(/^ /, ''));
    }
    if (dataLines.length === 0) return undefined;
    const payload = dataLines.join('\n');
    if (payload === '[DONE]') return 'DONE';
    try {
      return JSON.parse(payload) as OpenAICompatibleStreamChunk;
    } catch {
      // Malformed frame — skip. A real provider would not send these, but we
      // must not crash the whole stream on one bad chunk.
      return undefined;
    }
  }

  private pickChunkContent(chunk: OpenAICompatibleStreamChunk): string | null {
    const raw = chunk.choices?.[0]?.delta?.content;
    return typeof raw === 'string' && raw.length > 0 ? raw : null;
  }

  private getConfig(): { baseUrl: string; apiKey: string; model: string } {
    const baseUrl = this.normalizeBaseUrl(
      this.role === 'fallback'
        ? process.env.LLM_FALLBACK_OPENAI_COMPATIBLE_BASE_URL
        : process.env.LLM_OPENAI_COMPATIBLE_BASE_URL,
    );
    const apiKey =
      this.role === 'fallback'
        ? process.env.LLM_FALLBACK_OPENAI_COMPATIBLE_API_KEY
        : process.env.LLM_OPENAI_COMPATIBLE_API_KEY;
    const model =
      this.role === 'fallback'
        ? process.env.LLM_FALLBACK_OPENAI_COMPATIBLE_CHAT_MODEL
        : process.env.LLM_OPENAI_COMPATIBLE_CHAT_MODEL;

    if (!baseUrl || !apiKey || !model) {
      throw this.safeProviderConfigError();
    }

    return { baseUrl, apiKey, model };
  }

  private normalizeBaseUrl(value: string | undefined): string | undefined {
    const trimmed = value?.trim();
    return trimmed ? trimmed.replace(/\/+$/, '') : undefined;
  }

  private safeNumber(value: unknown): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
  }

  private safeProviderUnavailableError(fallbackEligible: boolean): AiError {
    return new AiError('AI_PROVIDER_UNAVAILABLE', 'provider_unavailable', {
      retryable: false,
      fallbackEligible,
    });
  }

  private safeProviderConfigError(): AiError {
    return new AiError(
      'AI_PROVIDER_CONFIG_INVALID',
      'provider_config_invalid',
      {
        retryable: false,
        fallbackEligible: false,
      },
    );
  }
}
