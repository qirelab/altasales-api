import { Module } from '@nestjs/common';
import { AiMonitoringService } from './ai-monitoring.service';
import { AiCacheService } from './ai-cache.service';
import { EmbeddingProxyService } from './embedding-proxy.service';
import { LlmProxyService } from './llm-proxy.service';
import { PiiAnonymizerService } from './pii-anonymizer.service';
import { AnonymizerLlmProvider } from './providers/anonymizer-llm.provider';
import { EMBEDDING_PROVIDER_ADAPTERS } from './providers/embedding-provider-registry';
import {
  FALLBACK_OPENAI_COMPATIBLE_CHAT_PROVIDER,
  LLM_PROVIDER_ADAPTERS,
  PRIMARY_OPENAI_COMPATIBLE_CHAT_PROVIDER,
} from './providers/llm-provider-registry';
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
    OpenAICompatibleEmbeddingProviderAdapter,
    {
      provide: PRIMARY_OPENAI_COMPATIBLE_CHAT_PROVIDER,
      useFactory: () => new OpenAICompatibleChatProviderAdapter('primary'),
    },
    {
      provide: FALLBACK_OPENAI_COMPATIBLE_CHAT_PROVIDER,
      useFactory: () => new OpenAICompatibleChatProviderAdapter('fallback'),
    },
    {
      provide: LLM_PROVIDER_ADAPTERS,
      useFactory: (
        mockProvider: MockLlmProvider,
        primaryOpenAICompatibleProvider: OpenAICompatibleChatProviderAdapter,
        fallbackOpenAICompatibleProvider: OpenAICompatibleChatProviderAdapter,
      ) => [
        mockProvider,
        primaryOpenAICompatibleProvider,
        fallbackOpenAICompatibleProvider,
      ],
      inject: [
        MockLlmProvider,
        PRIMARY_OPENAI_COMPATIBLE_CHAT_PROVIDER,
        FALLBACK_OPENAI_COMPATIBLE_CHAT_PROVIDER,
      ],
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
