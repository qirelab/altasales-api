import { Module } from '@nestjs/common';
import { LlmProxyService } from './llm-proxy.service';
import { PiiAnonymizerService } from './pii-anonymizer.service';
import { MockLlmProvider } from './providers/mock-llm.provider';

@Module({
  providers: [LlmProxyService, PiiAnonymizerService, MockLlmProvider],
  exports: [LlmProxyService],
})
export class AiModule {}
