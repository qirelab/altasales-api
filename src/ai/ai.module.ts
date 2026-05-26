import { Module } from '@nestjs/common';
import { AiCacheService } from './ai-cache.service';
import { LlmProxyService } from './llm-proxy.service';
import { PiiAnonymizerService } from './pii-anonymizer.service';
import { MockLlmProvider } from './providers/mock-llm.provider';

@Module({
  providers: [
    AiCacheService,
    LlmProxyService,
    PiiAnonymizerService,
    MockLlmProvider,
  ],
  exports: [LlmProxyService],
})
export class AiModule {}
