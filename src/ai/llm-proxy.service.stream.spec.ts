import { Logger, ServiceUnavailableException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AiCacheService } from './ai-cache.service';
import { AiMonitoringService } from './ai-monitoring.service';
import { AgentId } from './enums/agent-id.enum';
import { AnonymizationMode } from './enums/anonymization-mode.enum';
import { DataClass } from './enums/data-class.enum';
import { LlmProvider } from './enums/llm-provider.enum';
import { LlmTask } from './enums/llm-task.enum';
import { LlmChatRequest } from './interfaces/llm-chat-request.interface';
import { LlmChatStreamEvent } from './interfaces/llm-chat-stream-event.interface';
import { LlmProviderAdapter } from './interfaces/llm-provider-adapter.interface';
import { LlmProviderStreamEvent } from './interfaces/llm-provider-stream-event.interface';
import { LlmProxyService } from './llm-proxy.service';
import { PiiAnonymizerService } from './pii-anonymizer.service';
import { AnonymizerLlmProvider } from './providers/anonymizer-llm.provider';
import { LLM_PROVIDER_ADAPTERS } from './providers/llm-provider-registry';
import { MockLlmProvider } from './providers/mock-llm.provider';

/**
 * Coverage focus: streaming path invariants — validation, cache bypass,
 * anonymization block, PII scan on accumulated buffer, terminal usage.
 */
describe('LlmProxyService.chatStream', () => {
  let service: LlmProxyService;
  let originalEnv: Record<string, string | undefined>;
  let streamingProvider: LlmProviderAdapter & {
    streamChat: jest.Mock;
  };

  const request: LlmChatRequest = {
    agentId: AgentId.Chatbot,
    task: LlmTask.Reason,
    declaredDataClass: DataClass.NoPii,
    messages: [{ role: 'user', content: 'Как купить услугу?' }],
  };

  beforeEach(async () => {
    originalEnv = snapshotEnv();
    process.env.LLM_ANONYMIZATION_MODE = AnonymizationMode.DisabledForNoPii;
    process.env.LLM_PRIMARY_PROVIDER = LlmProvider.OpenAICompatible;
    process.env.LLM_PRIMARY_MODEL_ALIAS = 'chat-default';
    process.env.LLM_FALLBACK_ENABLED = 'false';

    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    jest.spyOn(Logger.prototype, 'error').mockImplementation();

    streamingProvider = {
      providerId: LlmProvider.OpenAICompatible,
      modelId: 'chat-default',
      providerRole: 'primary',
      isExternal: false,
      chat: jest.fn(),
      streamChat: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LlmProxyService,
        AiCacheService,
        AiMonitoringService,
        PiiAnonymizerService,
        MockLlmProvider,
        { provide: AnonymizerLlmProvider, useValue: { anonymize: jest.fn() } },
        {
          provide: LLM_PROVIDER_ADAPTERS,
          useValue: [streamingProvider],
        },
      ],
    }).compile();

    service = module.get(LlmProxyService);
  });

  afterEach(() => {
    restoreEnv(originalEnv);
    jest.restoreAllMocks();
  });

  it('yields deltas then a done event with the accumulated content and usage', async () => {
    streamingProvider.streamChat.mockImplementation(() =>
      asyncIterable<LlmProviderStreamEvent>([
        { type: 'delta', content: 'Как ' },
        { type: 'delta', content: 'купить.' },
        {
          type: 'done',
          usage: { tokensIn: 4, tokensOut: 2, costRub: 0, latencyMs: 5 },
        },
      ]),
    );

    const events: LlmChatStreamEvent[] = [];
    for await (const event of service.chatStream(request)) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: 'delta', content: 'Как ' },
      { type: 'delta', content: 'купить.' },
      {
        type: 'done',
        response: expect.objectContaining({
          content: 'Как купить.',
          providerId: LlmProvider.OpenAICompatible,
          modelId: 'chat-default',
          usage: expect.objectContaining({ tokensIn: 4, tokensOut: 2 }),
          dataClass: DataClass.NoPii,
        }),
      },
    ]);
    expect(streamingProvider.streamChat).toHaveBeenCalledTimes(1);
  });

  it('throws AI_STREAM_UNSUPPORTED when the provider has no streamChat', async () => {
    delete (streamingProvider as { streamChat?: unknown }).streamChat;

    let caught: unknown;
    try {
      for await (const _ of service.chatStream(request)) {
        // consume
      }
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ServiceUnavailableException);
    expect((caught as { safeErrorCode?: string }).safeErrorCode).toBe(
      'AI_STREAM_UNSUPPORTED',
    );
  });

  it('forwards the AbortSignal to provider.streamChat', async () => {
    streamingProvider.streamChat.mockImplementation(() =>
      asyncIterable<LlmProviderStreamEvent>([
        { type: 'delta', content: 'ok' },
        {
          type: 'done',
          usage: { tokensIn: 1, tokensOut: 1, costRub: 0, latencyMs: 1 },
        },
      ]),
    );
    const controller = new AbortController();

    for await (const _ of service.chatStream(request, controller.signal)) {
      // consume
    }

    expect(streamingProvider.streamChat).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ signal: controller.signal }),
    );
  });

  it('halts the stream when the accumulated buffer surfaces PII in the response', async () => {
    // The upstream emits partial PII across two deltas — the accumulated
    // scanner must catch it as soon as the full pattern lands.
    streamingProvider.streamChat.mockImplementation(() =>
      asyncIterable<LlmProviderStreamEvent>([
        { type: 'delta', content: 'Пришлите на почту test' },
        { type: 'delta', content: '@example.com пожалуйста' },
        {
          type: 'done',
          usage: { tokensIn: 1, tokensOut: 1, costRub: 0, latencyMs: 1 },
        },
      ]),
    );

    let caught: unknown;
    const emitted: LlmChatStreamEvent[] = [];
    try {
      for await (const event of service.chatStream(request)) {
        emitted.push(event);
      }
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeDefined();
    // At most the first (PII-clean) delta reached the caller.
    expect(
      emitted.filter((event) => event.type === 'delta').length,
    ).toBeLessThanOrEqual(1);
  });
});

async function* asyncIterable<T>(items: T[]): AsyncGenerator<T> {
  for (const item of items) {
    yield item;
  }
}

function snapshotEnv(): Record<string, string | undefined> {
  const keys = Object.keys(process.env).filter((key) => key.startsWith('LLM_'));
  const snapshot: Record<string, string | undefined> = {};
  for (const key of keys) snapshot[key] = process.env[key];
  return snapshot;
}

function restoreEnv(snapshot: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(snapshot)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}
