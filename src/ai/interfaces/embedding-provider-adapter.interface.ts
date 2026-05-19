import { LlmUsage } from './llm-usage.interface';

export interface EmbeddingProviderRequestOptions {
  signal?: AbortSignal;
}

export interface EmbeddingProviderResponse {
  vectors: number[][];
  usage: LlmUsage;
  dimensions: number;
}

export interface EmbeddingProviderAdapter {
  providerId: string;
  modelId: string;
  isExternal?: boolean;
  embed(
    inputs: string[],
    options?: EmbeddingProviderRequestOptions,
  ): Promise<EmbeddingProviderResponse>;
}
