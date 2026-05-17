import { Module } from '@nestjs/common';
import { LlmProxyService } from './llm-proxy.service';
import { PiiAnonymizerService } from './pii-anonymizer.service';
import { AnonymizerLlmProvider } from './providers/anonymizer-llm.provider';
import { MockLlmProvider } from './providers/mock-llm.provider';

@Module({
  providers: [
    LlmProxyService,
    PiiAnonymizerService,
    MockLlmProvider,
    AnonymizerLlmProvider,
  ],
  exports: [LlmProxyService],
})
export class AiModule {}
