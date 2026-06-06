import { Module } from '@nestjs/common';
import { AiMonitoringService } from './ai-monitoring.service';
import { AiCacheService } from './ai-cache.service';
import { EmbeddingProxyService } from './embedding-proxy.service';
import { LlmProxyService } from './llm-proxy.service';
import { PiiAnonymizerService } from './pii-anonymizer.service';
import { AnonymizerLlmProvider } from './providers/anonymizer-llm.provider';
import { EMBEDDING_PROVIDER_ADAPTERS } from './providers/embedding-provider-registry';
import { LLM_PROVIDER_ADAPTERS } from './providers/llm-provider-registry';
import { MockLlmProvider } from './providers/mock-llm.provider';
import { OpenAICompatibleChatProviderAdapter } from './providers/openai-compatible-chat.provider';
import { OpenAICompatibleEmbeddingProviderAdapter } from './providers/openai-compatible-embedding.provider';

@Module({
  providers: [
    AiCacheService,
    LlmProxyService,
    EmbeddingProxyService,
    AiMonitoringService,
    PiiAnonymizerService,
    MockLlmProvider,
    AnonymizerLlmProvider,
    OpenAICompatibleChatProviderAdapter,
    OpenAICompatibleEmbeddingProviderAdapter,
    {
      provide: LLM_PROVIDER_ADAPTERS,
      useFactory: (
        mockProvider: MockLlmProvider,
        openAICompatibleProvider: OpenAICompatibleChatProviderAdapter,
      ) => [mockProvider, openAICompatibleProvider],
      inject: [MockLlmProvider, OpenAICompatibleChatProviderAdapter],
    },
    {
      provide: EMBEDDING_PROVIDER_ADAPTERS,
      useFactory: (
        openAICompatibleProvider: OpenAICompatibleEmbeddingProviderAdapter,
      ) => [openAICompatibleProvider],
      inject: [OpenAICompatibleEmbeddingProviderAdapter],
    },
  ],
  exports: [LlmProxyService, EmbeddingProxyService, AiCacheService],
})
export class AiModule {}
