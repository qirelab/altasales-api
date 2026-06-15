import { Injectable } from '@nestjs/common';
import { AiError, normalizeProviderError } from '../errors/ai-error';
import { LlmProvider } from '../enums/llm-provider.enum';
import {
  LlmProviderAdapter,
  LlmProviderRequestOptions,
  LlmProviderResponse,
} from '../interfaces/llm-provider-adapter.interface';
import { LlmMessage } from '../interfaces/llm-message.interface';

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
