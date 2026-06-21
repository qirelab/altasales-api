import { Test, TestingModule } from '@nestjs/testing';
import { AiModule } from './ai.module';
import { LlmProvider } from './enums/llm-provider.enum';
import {
  LLM_PROVIDER_ADAPTERS,
  LlmProviderRegistry,
} from './providers/llm-provider-registry';

describe('AiModule', () => {
  let module: TestingModule;

  afterEach(async () => {
    await module?.close();
  });

  it('registers primary and fallback OpenAI-compatible chat providers', async () => {
    module = await Test.createTestingModule({
      imports: [AiModule],
    }).compile();

    const providers = module.get<LlmProviderRegistry>(LLM_PROVIDER_ADAPTERS);
    const openAICompatibleProviders = providers.filter(
      (provider) => provider.providerId === LlmProvider.OpenAICompatible,
    );

    expect(
      openAICompatibleProviders.map((provider) => provider.providerRole),
    ).toEqual(['primary', 'fallback']);
  });
});
