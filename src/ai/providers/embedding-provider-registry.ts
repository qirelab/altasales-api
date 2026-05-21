import { EmbeddingProviderAdapter } from '../interfaces/embedding-provider-adapter.interface';

export const EMBEDDING_PROVIDER_ADAPTERS = Symbol(
  'EMBEDDING_PROVIDER_ADAPTERS',
);

export type EmbeddingProviderRegistry = EmbeddingProviderAdapter[];
