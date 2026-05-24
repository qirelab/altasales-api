import { Injectable } from '@nestjs/common';
import { AiError, normalizeProviderError } from '../errors/ai-error';
import { LlmProvider } from '../enums/llm-provider.enum';
import {
  EmbeddingProviderAdapter,
  EmbeddingProviderRequestOptions,
  EmbeddingProviderResponse,
} from '../interfaces/embedding-provider-adapter.interface';

const DEFAULT_EMBEDDING_MODEL_ALIAS = 'embedding-default';

type OpenAICompatibleEmbeddingResponse = {
  data?: Array<{
    index?: unknown;
    embedding?: unknown;
  }>;
  usage?: {
    prompt_tokens?: unknown;
    total_tokens?: unknown;
  };
};

@Injectable()
export class OpenAICompatibleEmbeddingProviderAdapter
  implements EmbeddingProviderAdapter
{
  readonly providerId = LlmProvider.OpenAICompatible;

  get modelId(): string {
    return process.env.LLM_EMBEDDING_MODEL_ALIAS || DEFAULT_EMBEDDING_MODEL_ALIAS;
  }

  get isExternal(): boolean {
    return process.env.LLM_OPENAI_COMPATIBLE_EMBEDDING_IS_EXTERNAL !== 'false';
  }

  async embed(
    inputs: string[],
    options?: EmbeddingProviderRequestOptions,
  ): Promise<EmbeddingProviderResponse> {
    const startedAt = Date.now();
    const config = this.getConfig();
    const response = await fetch(`${config.baseUrl}/v1/embeddings`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: config.model,
        input: inputs,
      }),
      signal: options?.signal,
    });

    if (!response.ok) {
      throw normalizeProviderError({ status: response.status });
    }

    const body = (await response.json()) as OpenAICompatibleEmbeddingResponse;
    const vectors = this.extractVectors(body, inputs.length);
    const dimensions = vectors[0]?.length ?? 0;
    this.assertDimensions(vectors, config.dimensions);

    return {
      vectors,
      dimensions,
      usage: {
        tokensIn: this.safeNumber(
          body.usage?.prompt_tokens ?? body.usage?.total_tokens,
        ),
        tokensOut: 0,
        costRub: 0,
        latencyMs: Date.now() - startedAt,
      },
    };
  }

  private getConfig(): {
    baseUrl: string;
    apiKey: string;
    model: string;
    dimensions?: number;
  } {
    const baseUrl = this.normalizeBaseUrl(
      process.env.LLM_OPENAI_COMPATIBLE_BASE_URL,
    );
    const apiKey = process.env.LLM_OPENAI_COMPATIBLE_API_KEY;
    const model = process.env.LLM_OPENAI_COMPATIBLE_EMBEDDING_MODEL;
    const dimensions = this.getPositiveInteger(
      process.env.LLM_OPENAI_COMPATIBLE_EMBEDDING_DIMENSIONS,
    );

    if (!baseUrl || !apiKey || !model) {
      throw this.safeEmbeddingProviderUnavailableError();
    }

    return { baseUrl, apiKey, model, dimensions };
  }

  private extractVectors(
    body: OpenAICompatibleEmbeddingResponse,
    expectedCount: number,
  ): number[][] {
    if (!Array.isArray(body.data) || body.data.length !== expectedCount) {
      throw this.safeEmbeddingResponseInvalidError();
    }

    const sorted = [...body.data].sort((left, right) => {
      const leftIndex = typeof left.index === 'number' ? left.index : 0;
      const rightIndex = typeof right.index === 'number' ? right.index : 0;
      return leftIndex - rightIndex;
    });
    const vectors = sorted.map((item) => item.embedding);

    if (!vectors.every((vector) => this.isNumberVector(vector))) {
      throw this.safeEmbeddingResponseInvalidError();
    }

    return vectors as number[][];
  }

  private assertDimensions(vectors: number[][], expected?: number): void {
    const dimensions = vectors[0]?.length;
    const hasConsistentDimensions = vectors.every(
      (vector) => vector.length === dimensions,
    );
    if (
      !dimensions ||
      !hasConsistentDimensions ||
      (expected && dimensions !== expected)
    ) {
      throw this.safeEmbeddingResponseInvalidError();
    }
  }

  private isNumberVector(value: unknown): value is number[] {
    return (
      Array.isArray(value) &&
      value.length > 0 &&
      value.every((entry) => typeof entry === 'number' && Number.isFinite(entry))
    );
  }

  private normalizeBaseUrl(value: string | undefined): string | undefined {
    const trimmed = value?.trim();
    return trimmed ? trimmed.replace(/\/+$/, '') : undefined;
  }

  private safeNumber(value: unknown): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
  }

  private getPositiveInteger(value: string | undefined): number | undefined {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
  }

  private safeEmbeddingProviderUnavailableError(): AiError {
    return new AiError(
      'AI_EMBEDDING_PROVIDER_UNAVAILABLE',
      'embedding_provider_unavailable',
      {
        retryable: false,
        fallbackEligible: false,
      },
    );
  }

  private safeEmbeddingResponseInvalidError(): AiError {
    return new AiError(
      'AI_EMBEDDING_RESPONSE_INVALID',
      'embedding_response_invalid',
      {
        retryable: false,
        fallbackEligible: false,
      },
    );
  }
}
