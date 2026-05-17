import { Module } from '@nestjs/common';
import { AiMonitoringService } from './ai-monitoring.service';
import { LlmProxyService } from './llm-proxy.service';
import { PiiAnonymizerService } from './pii-anonymizer.service';
import { AnonymizerLlmProvider } from './providers/anonymizer-llm.provider';
import { LLM_PROVIDER_ADAPTERS } from './providers/llm-provider-registry';
import { MockLlmProvider } from './providers/mock-llm.provider';

@Module({
  providers: [
    LlmProxyService,
    AiMonitoringService,
    PiiAnonymizerService,
    MockLlmProvider,
    AnonymizerLlmProvider,
    {
      provide: LLM_PROVIDER_ADAPTERS,
      useFactory: (mockProvider: MockLlmProvider) => [mockProvider],
      inject: [MockLlmProvider],
    },
  ],
  exports: [LlmProxyService],
})
export class AiModule {}
