import { readFileSync } from 'node:fs';
import {
  BadRequestException,
  ForbiddenException,
  GatewayTimeoutException,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AiCacheService } from './ai-cache.service';
import { AiMonitoringService } from './ai-monitoring.service';
import { AiError } from './errors/ai-error';
import { AgentId } from './enums/agent-id.enum';
import { AiMonitoringEventName } from './enums/ai-monitoring-event-name.enum';
import { AiMonitoringOperation } from './enums/ai-monitoring-operation.enum';
import { AiMonitoringStage } from './enums/ai-monitoring-stage.enum';
import { AiMonitoringStatus } from './enums/ai-monitoring-status.enum';
import { AnonymizationMode } from './enums/anonymization-mode.enum';
import { DataClass } from './enums/data-class.enum';
import { LlmProvider } from './enums/llm-provider.enum';
import { LlmTask } from './enums/llm-task.enum';
import { AnonymizerProvider } from './interfaces/anonymizer-provider.interface';
import { LlmChatRequest } from './interfaces/llm-chat-request.interface';
import { LlmMessage } from './interfaces/llm-message.interface';
import { LlmProviderAdapter } from './interfaces/llm-provider-adapter.interface';
import { LlmProxyService } from './llm-proxy.service';
import { PiiAnonymizerService } from './pii-anonymizer.service';
import { LLM_PROVIDER_ADAPTERS } from './providers/llm-provider-registry';
import { AnonymizerLlmProvider } from './providers/anonymizer-llm.provider';
import { MockLlmProvider } from './providers/mock-llm.provider';

describe('LlmProxyService', () => {
  let service: LlmProxyService;
  let provider: MockLlmProvider;
  let fallbackProvider: MockLlmProvider;
  let openAICompatibleProvider: LlmProviderAdapter;
  let fallbackOpenAICompatibleProvider: LlmProviderAdapter;
  let anonymizerProvider: { anonymize: jest.Mock };
  let piiAnonymizer: PiiAnonymizerService;
  let aiCache: AiCacheService;
  let loggerLogSpy: jest.SpyInstance;
  let loggerWarnSpy: jest.SpyInstance;
  let loggerErrorSpy: jest.SpyInstance;
  let originalEnv: Record<string, string | undefined>;

  const baseRequest: LlmChatRequest = {
    agentId: AgentId.Chatbot,
    task: LlmTask.Summarize,
    messages: [{ role: 'user', content: 'Summarize public information' }],
  };

  beforeEach(async () => {
    originalEnv = snapshotEnv();
    process.env.LLM_ANONYMIZATION_MODE = AnonymizationMode.Required;
    process.env.LLM_PROVIDER_MAX_ATTEMPTS = '2';
    process.env.LLM_PROVIDER_BACKOFF_BASE_MS = '1';
    process.env.LLM_PROVIDER_BACKOFF_MAX_MS = '1';
    process.env.LLM_PROVIDER_TIMEOUT_MS = '10000';
    process.env.LLM_PRIMARY_PROVIDER = LlmProvider.Mock;
    process.env.LLM_PRIMARY_MODEL_ALIAS = 'mock-llm-v1';
    process.env.LLM_FALLBACK_ENABLED = 'false';
    process.env.LLM_FALLBACK_PROVIDER = LlmProvider.OpenAICompatible;
    process.env.LLM_FALLBACK_MODEL_ALIAS = 'chat-fallback';
    process.env.LLM_FALLBACK_OPENAI_COMPATIBLE_BASE_URL =
      'https://fallback-provider.test';
    process.env.LLM_FALLBACK_OPENAI_COMPATIBLE_API_KEY = 'fallback-secret-key';
    process.env.LLM_FALLBACK_OPENAI_COMPATIBLE_CHAT_MODEL =
      'real-fallback-chat-model';
    process.env.LLM_FALLBACK_PROVIDER_MAX_ATTEMPTS = '1';
    process.env.LLM_FALLBACK_PROVIDER_BACKOFF_BASE_MS = '1';
    process.env.LLM_FALLBACK_PROVIDER_BACKOFF_MAX_MS = '1';
    process.env.LLM_FALLBACK_PROVIDER_TIMEOUT_MS = '10000';

    loggerLogSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    loggerWarnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    loggerErrorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation();

    anonymizerProvider = {
      anonymize: jest.fn(({ messages }: { messages: LlmMessage[] }) =>
        JSON.stringify({
          messages,
          entities: [],
          placeholderMap: {},
          stats: {},
        }),
      ),
    };
    fallbackProvider = new MockLlmProvider();
    Object.defineProperty(fallbackProvider, 'modelId', {
      value: 'mock-fallback-v1',
    });
    openAICompatibleProvider = {
      providerId: LlmProvider.OpenAICompatible,
      modelId: 'chat-default',
      providerRole: 'primary',
      isExternal: false,
      chat: jest.fn().mockResolvedValue({
        content: 'OpenAI-compatible response',
        usage: usage(),
      }),
    };
    fallbackOpenAICompatibleProvider = {
      providerId: LlmProvider.OpenAICompatible,
      modelId: 'chat-fallback',
      providerRole: 'fallback',
      isExternal: false,
      chat: jest.fn().mockResolvedValue({
        content: 'Fallback OpenAI-compatible response',
        usage: usage(),
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LlmProxyService,
        AiCacheService,
        AiMonitoringService,
        PiiAnonymizerService,
        MockLlmProvider,
        {
          provide: AnonymizerLlmProvider,
          useValue: anonymizerProvider,
        },
        {
          provide: LLM_PROVIDER_ADAPTERS,
          useFactory: (mockProvider: MockLlmProvider) => [
            mockProvider,
            fallbackProvider,
            openAICompatibleProvider,
            fallbackOpenAICompatibleProvider,
          ],
          inject: [MockLlmProvider],
        },
      ],
    }).compile();

    service = module.get(LlmProxyService);
    provider = module.get(MockLlmProvider);
    piiAnonymizer = module.get(PiiAnonymizerService);
    aiCache = module.get(AiCacheService);
  });

  afterEach(() => {
    restoreEnv(originalEnv);
    jest.restoreAllMocks();
  });

  it('mode required calls anonymizer', async () => {
    await service.chat(baseRequest);

    expect(anonymizerProvider.anonymize).toHaveBeenCalledTimes(1);
  });

  it('mode required calls anonymizer when hint is missing', async () => {
    await service.chat({ ...baseRequest, declaredDataClass: undefined });

    expect(anonymizerProvider.anonymize).toHaveBeenCalledTimes(1);
  });

  it('mode required still calls anonymizer for explicit no_pii', async () => {
    const chatSpy = jest.spyOn(provider, 'chat');

    await service.chat({
      ...baseRequest,
      declaredDataClass: DataClass.NoPii,
    });

    expect(anonymizerProvider.anonymize).toHaveBeenCalledTimes(1);
    expect(chatSpy).toHaveBeenCalledTimes(1);
  });

  it('mode disabled_for_no_pii lets explicit no_pii skip anonymizer', async () => {
    process.env.LLM_ANONYMIZATION_MODE = AnonymizationMode.DisabledForNoPii;

    await service.chat({
      ...baseRequest,
      declaredDataClass: DataClass.NoPii,
    });

    expect(anonymizerProvider.anonymize).not.toHaveBeenCalled();
  });

  it('mode disabled_for_no_pii blocks misdeclared no_pii PII before provider and cache', async () => {
    process.env.LLM_ANONYMIZATION_MODE = AnonymizationMode.DisabledForNoPii;
    const chatSpy = jest.spyOn(provider, 'chat');
    const buildKeySpy = jest.spyOn(aiCache, 'buildKey');
    const cacheReadSpy = jest.spyOn(aiCache, 'read');
    const cacheWriteSpy = jest.spyOn(aiCache, 'write');

    await expect(
      service.chat({
        ...baseRequest,
        declaredDataClass: DataClass.NoPii,
        messages: [
          {
            role: 'user',
            content:
              'Contact user@example.com, +7 (999) 123-45-67, ИНН 7707083893',
          },
        ],
        policy: { cacheTtlMs: 60_000 },
      }),
    ).rejects.toThrow(
      new ForbiddenException('LLM request blocked by data policy'),
    );

    expect(anonymizerProvider.anonymize).not.toHaveBeenCalled();
    expect(chatSpy).not.toHaveBeenCalled();
    expect(buildKeySpy).not.toHaveBeenCalled();
    expect(cacheReadSpy).not.toHaveBeenCalled();
    expect(cacheWriteSpy).not.toHaveBeenCalled();
  });

  it('mode disabled_for_no_pii does not treat missing hint as no_pii', async () => {
    process.env.LLM_ANONYMIZATION_MODE = AnonymizationMode.DisabledForNoPii;

    await service.chat(baseRequest);

    expect(anonymizerProvider.anonymize).toHaveBeenCalledTimes(1);
  });

  it('mode disabled does not call anonymizer for explicit no_pii', async () => {
    process.env.LLM_ANONYMIZATION_MODE = AnonymizationMode.Disabled;

    await service.chat({
      ...baseRequest,
      declaredDataClass: DataClass.NoPii,
    });

    expect(anonymizerProvider.anonymize).not.toHaveBeenCalled();
  });

  it('mode disabled allows missing hint without treating it as no_pii', async () => {
    process.env.LLM_ANONYMIZATION_MODE = AnonymizationMode.Disabled;

    const response = await service.chat(baseRequest);

    expect(response.dataClass).toBe(DataClass.RawPii);
    expect(anonymizerProvider.anonymize).not.toHaveBeenCalled();
  });

  it('mode disabled allows PII input to reach trusted provider without anonymizer', async () => {
    process.env.LLM_ANONYMIZATION_MODE = AnonymizationMode.Disabled;
    const chatSpy = jest.spyOn(provider, 'chat').mockResolvedValueOnce({
      content: 'Trusted provider response',
      usage: usage(),
    });

    const response = await service.chat({
      ...baseRequest,
      messages: [
        {
          role: 'user',
          content:
            'Contact user@example.com, +7 (999) 123-45-67, ИНН 7707083893',
        },
      ],
    });

    expect(response.content).toBe('Trusted provider response');
    expect(response.dataClass).toBe(DataClass.RawPii);
    expect(anonymizerProvider.anonymize).not.toHaveBeenCalled();
    expect(chatSpy).toHaveBeenCalledWith(
      [
        {
          role: 'user',
          content:
            'Contact user@example.com, +7 (999) 123-45-67, ИНН 7707083893',
        },
      ],
      expect.any(Object),
    );
  });

  it('mode disabled keeps misdeclared PII input out of cache without blocking provider', async () => {
    process.env.LLM_ANONYMIZATION_MODE = AnonymizationMode.Disabled;
    const chatSpy = jest.spyOn(provider, 'chat').mockResolvedValueOnce({
      content: 'Trusted provider response',
      usage: usage(),
    });
    const buildKeySpy = jest.spyOn(aiCache, 'buildKey');
    const cacheReadSpy = jest.spyOn(aiCache, 'read');
    const cacheWriteSpy = jest.spyOn(aiCache, 'write');

    const response = await service.chat({
      ...baseRequest,
      declaredDataClass: DataClass.NoPii,
      messages: [{ role: 'user', content: 'Email user@example.com' }],
      policy: { cacheTtlMs: 60_000 },
    });

    expect(response.content).toBe('Trusted provider response');
    expect(response.dataClass).toBe(DataClass.RawPii);
    expect(response.cacheKey).toBeUndefined();
    expect(response.cacheHit).toBeUndefined();
    expect(anonymizerProvider.anonymize).not.toHaveBeenCalled();
    expect(chatSpy).toHaveBeenCalledTimes(1);
    expect(buildKeySpy).not.toHaveBeenCalled();
    expect(cacheReadSpy).not.toHaveBeenCalled();
    expect(cacheWriteSpy).not.toHaveBeenCalled();
    const serializedLogs = serializeLogs();
    expect(serializedLogs).toContain(DataClass.RawPii);
    expect(serializedLogs).not.toContain(DataClass.NoPii);
    expect(serializedLogs).not.toContain('user@example.com');
  });

  it('mode disabled allows provider response containing PII', async () => {
    process.env.LLM_ANONYMIZATION_MODE = AnonymizationMode.Disabled;
    jest.spyOn(provider, 'chat').mockResolvedValueOnce({
      content: 'Email user@example.com',
      usage: usage(),
    });

    const response = await service.chat(baseRequest);

    expect(response.content).toBe('Email user@example.com');
    expect(response.dataClass).toBe(DataClass.RawPii);
  });

  it('mode disabled returns provider PII but never caches it', async () => {
    process.env.LLM_ANONYMIZATION_MODE = AnonymizationMode.Disabled;
    const cachedRequest = {
      ...baseRequest,
      declaredDataClass: DataClass.NoPii,
      policy: { cacheTtlMs: 60_000 },
    };
    const chatSpy = jest
      .spyOn(provider, 'chat')
      .mockResolvedValueOnce({
        content: 'Email first@example.com',
        usage: usage(),
      })
      .mockResolvedValueOnce({
        content: 'Email second@example.com',
        usage: usage(),
      });
    const cacheWriteSpy = jest.spyOn(aiCache, 'write');

    const first = await service.chat(cachedRequest);
    const second = await service.chat(cachedRequest);

    expect(first.content).toBe('Email first@example.com');
    expect(second.content).toBe('Email second@example.com');
    expect(first.cacheHit).toBe(false);
    expect(second.cacheHit).toBe(false);
    expect(chatSpy).toHaveBeenCalledTimes(2);
    expect(cacheWriteSpy).not.toHaveBeenCalled();
  });

  it('mode disabled logs safely without raw prompt or response PII', async () => {
    process.env.LLM_ANONYMIZATION_MODE = AnonymizationMode.Disabled;
    jest.spyOn(provider, 'chat').mockResolvedValueOnce({
      content: 'Email user@example.com',
      usage: usage(),
    });

    await service.chat({
      ...baseRequest,
      messages: [{ role: 'user', content: 'Phone +7 (999) 123-45-67' }],
    });

    const serializedLogs = serializeLogs();
    expect(serializedLogs).toContain(DataClass.RawPii);
    expect(serializedLogs).not.toContain('Phone +7 (999) 123-45-67');
    expect(serializedLogs).not.toContain('Email user@example.com');
    expect(serializedLogs).not.toContain('user@example.com');
    expect(serializedLogs).not.toContain('+7 (999) 123-45-67');
    expect(serializedLogs).not.toContain('placeholderMap');
  });

  it('mode disabled does not cache trusted missing-hint PII flows', async () => {
    process.env.LLM_ANONYMIZATION_MODE = AnonymizationMode.Disabled;
    const cachedRequest = {
      ...baseRequest,
      messages: [{ role: 'user' as const, content: 'Email user@example.com' }],
      policy: { cacheTtlMs: 60_000 },
    };
    const chatSpy = jest
      .spyOn(provider, 'chat')
      .mockResolvedValueOnce({
        content: 'Trusted response one',
        usage: usage(),
      })
      .mockResolvedValueOnce({
        content: 'Trusted response two',
        usage: usage(),
      });
    const buildKeySpy = jest.spyOn(aiCache, 'buildKey');
    const cacheReadSpy = jest.spyOn(aiCache, 'read');
    const cacheWriteSpy = jest.spyOn(aiCache, 'write');

    const first = await service.chat(cachedRequest);
    const second = await service.chat(cachedRequest);

    expect(first.cacheKey).toBeUndefined();
    expect(first.cacheHit).toBeUndefined();
    expect(second.cacheKey).toBeUndefined();
    expect(second.cacheHit).toBeUndefined();
    expect(second.content).toBe('Trusted response two');
    expect(first.dataClass).toBe(DataClass.RawPii);
    expect(second.dataClass).toBe(DataClass.RawPii);
    expect(chatSpy).toHaveBeenCalledTimes(2);
    expect(buildKeySpy).not.toHaveBeenCalled();
    expect(cacheReadSpy).not.toHaveBeenCalled();
    expect(cacheWriteSpy).not.toHaveBeenCalled();
  });

  it('mode disabled allows cache only for explicit no_pii trusted flows', async () => {
    process.env.LLM_ANONYMIZATION_MODE = AnonymizationMode.Disabled;
    const cachedRequest = {
      ...baseRequest,
      declaredDataClass: DataClass.NoPii,
      policy: { cacheTtlMs: 60_000 },
    };
    const chatSpy = jest.spyOn(provider, 'chat').mockResolvedValueOnce({
      content: 'Cacheable trusted no_pii response',
      usage: usage(),
    });

    const first = await service.chat(cachedRequest);
    const second = await service.chat(cachedRequest);

    expect(first.cacheHit).toBe(false);
    expect(second.cacheHit).toBe(true);
    expect(second.content).toBe('Cacheable trusted no_pii response');
    expect(chatSpy).toHaveBeenCalledTimes(1);
  });

  it('mode disabled still allows fallback on transient provider errors', async () => {
    process.env.LLM_ANONYMIZATION_MODE = AnonymizationMode.Disabled;
    process.env.LLM_PROVIDER_MAX_ATTEMPTS = '1';
    process.env.LLM_FALLBACK_ENABLED = 'true';
    jest
      .spyOn(provider, 'chat')
      .mockRejectedValueOnce(new TypeError('primary unavailable'));
    const fallbackSpy = jest
      .spyOn(fallbackOpenAICompatibleProvider, 'chat')
      .mockResolvedValueOnce({
        content: 'Fallback response with email user@example.com',
        usage: usage(),
      });

    const response = await service.chat({
      ...baseRequest,
      messages: [{ role: 'user', content: 'Email user@example.com' }],
    });

    expect(response.content).toBe(
      'Fallback response with email user@example.com',
    );
    expect(response.dataClass).toBe(DataClass.RawPii);
    expect(response.providerId).toBe(LlmProvider.OpenAICompatible);
    expect(response.modelId).toBe('chat-fallback');
    expect(fallbackSpy).toHaveBeenCalledTimes(1);
  });

  it('mode disabled returns fallback PII but never caches it', async () => {
    process.env.LLM_ANONYMIZATION_MODE = AnonymizationMode.Disabled;
    process.env.LLM_PROVIDER_MAX_ATTEMPTS = '1';
    process.env.LLM_FALLBACK_ENABLED = 'true';
    const primarySpy = jest
      .spyOn(provider, 'chat')
      .mockRejectedValue(new TypeError('primary unavailable'));
    const fallbackSpy = jest
      .spyOn(fallbackOpenAICompatibleProvider, 'chat')
      .mockResolvedValueOnce({
        content: 'Fallback email first@example.com',
        usage: usage(),
      })
      .mockResolvedValueOnce({
        content: 'Fallback email second@example.com',
        usage: usage(),
      });
    const cacheWriteSpy = jest.spyOn(aiCache, 'write');
    const request = {
      ...baseRequest,
      declaredDataClass: DataClass.NoPii,
      policy: { cacheTtlMs: 60_000 },
    };

    const first = await service.chat(request);
    const second = await service.chat(request);

    expect(first.content).toBe('Fallback email first@example.com');
    expect(second.content).toBe('Fallback email second@example.com');
    expect(first.cacheHit).toBe(false);
    expect(second.cacheHit).toBe(false);
    expect(primarySpy).toHaveBeenCalledTimes(2);
    expect(fallbackSpy).toHaveBeenCalledTimes(2);
    expect(cacheWriteSpy).not.toHaveBeenCalled();
  });

  it('anonymizer unavailable fails closed in required mode', async () => {
    anonymizerProvider.anonymize.mockRejectedValueOnce(
      new Error('private provider URL https://secret.example'),
    );

    await expect(service.chat(baseRequest)).rejects.toThrow(
      new ForbiddenException('LLM request blocked by data policy'),
    );
  });

  it('malformed anonymizer JSON fails closed', async () => {
    const rawMarker = 'ordinary-anonymizer-response-marker';
    anonymizerProvider.anonymize.mockResolvedValueOnce(rawMarker);
    const chatSpy = jest.spyOn(provider, 'chat');

    await expect(service.chat(baseRequest)).rejects.toMatchObject({
      message: 'LLM request validation failed',
      safeErrorCode: 'AI_VALIDATION_FAILED',
    });
    expect(chatSpy).not.toHaveBeenCalled();
    expect(loggerLogSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: AiMonitoringEventName.AiStageFailed,
        stage: AiMonitoringStage.Anonymization,
        errorCode: 'AI_VALIDATION_FAILED',
      }),
    );

    const serializedLogs = loggerLogSpy.mock.calls
      .flat()
      .map((entry) => JSON.stringify(entry))
      .join(' ');
    expect(serializedLogs).not.toContain(rawMarker);
  });

  it('changed message count fails closed', async () => {
    anonymizerProvider.anonymize.mockResolvedValueOnce(
      JSON.stringify({
        messages: [],
        entities: [],
        placeholderMap: {},
        stats: {},
      }),
    );

    await expect(service.chat(baseRequest)).rejects.toThrow(
      new BadRequestException('LLM request validation failed'),
    );
  });

  it('changed message role fails closed', async () => {
    anonymizerProvider.anonymize.mockResolvedValueOnce(
      JSON.stringify({
        messages: [{ role: 'assistant', content: 'Changed role' }],
        entities: [],
        placeholderMap: {},
        stats: {},
      }),
    );

    await expect(service.chat(baseRequest)).rejects.toThrow(
      new BadRequestException('LLM request validation failed'),
    );
  });

  it('unsupported anonymizer entity type fails closed', async () => {
    anonymizerProvider.anonymize.mockResolvedValueOnce(
      JSON.stringify({
        messages: [{ role: 'user', content: '{{PII_SECRET_0001}}' }],
        entities: [
          {
            placeholder: '{{PII_SECRET_0001}}',
            type: 'secret',
            description: 'unsupported',
          },
        ],
        placeholderMap: {
          '{{PII_SECRET_0001}}': 'raw secret',
        },
        stats: { secret: 1 },
      }),
    );

    await expect(service.chat(baseRequest)).rejects.toThrow(
      new BadRequestException('LLM request validation failed'),
    );
  });

  it('main provider receives anonymized messages and semantic descriptions only', async () => {
    anonymizerProvider.anonymize.mockResolvedValueOnce(
      anonymizedEmailResponse(baseRequest.messages),
    );
    const chatSpy = jest.spyOn(provider, 'chat');

    await service.chat(baseRequest);

    const providerMessages = chatSpy.mock.calls[0][0];
    const serialized = JSON.stringify(providerMessages);
    expect(serialized).toContain('{{PII_EMAIL_0001}}');
    expect(serialized).toContain('email address');
    expect(serialized).toContain('intentional anonymization');
    expect(serialized).not.toContain('user@example.com');
    expect(providerMessages[0].role).toBe('system');
  });

  it('deterministically restores provider response placeholders', async () => {
    anonymizerProvider.anonymize.mockResolvedValueOnce(
      anonymizedEmailResponse(baseRequest.messages),
    );
    jest.spyOn(provider, 'chat').mockResolvedValueOnce({
      content: 'Email: {{PII_EMAIL_0001}}',
      usage: usage(),
    });

    const response = await service.chat(baseRequest);

    expect(response.content).toBe('Email: user@example.com');
    expect(response.dataClass).toBe(DataClass.AnonymizedPii);
    expect(response.anonymizationStats).toEqual({ email: 1 });
  });

  it('unresolved placeholders fail closed', async () => {
    anonymizerProvider.anonymize.mockResolvedValueOnce(
      anonymizedEmailResponse(baseRequest.messages),
    );
    jest.spyOn(provider, 'chat').mockResolvedValueOnce({
      content: 'Phone: {{PII_PHONE_0001}}',
      usage: usage(),
    });

    await expect(service.chat(baseRequest)).rejects.toThrow(
      new BadRequestException('LLM response restore failed'),
    );
  });

  it('post-anonymization scan catches remaining structured PII', async () => {
    anonymizerProvider.anonymize.mockResolvedValueOnce(
      JSON.stringify({
        messages: [{ role: 'user', content: 'Contact leak@example.com' }],
        entities: [],
        placeholderMap: {},
        stats: {},
      }),
    );

    await expect(service.chat(baseRequest)).rejects.toThrow(
      new BadRequestException('LLM request validation failed'),
    );
  });

  it('dirty provider error does not leak prompt, url, headers, body, or key', async () => {
    process.env.LLM_PROVIDER_MAX_ATTEMPTS = '1';
    anonymizerProvider.anonymize.mockResolvedValueOnce(
      anonymizedEmailResponse(baseRequest.messages),
    );
    jest
      .spyOn(provider, 'chat')
      .mockRejectedValueOnce(
        new Error(
          'https://api.provider.test Authorization Bearer secret-key body user@example.com',
        ),
      );

    await expect(service.chat(baseRequest)).rejects.toThrow(
      new ServiceUnavailableException('LLM provider is unavailable'),
    );

    const serializedLogs = serializeLogs();
    expect(serializedLogs).not.toContain('https://api.provider.test');
    expect(serializedLogs).not.toContain('Authorization');
    expect(serializedLogs).not.toContain('secret-key');
    expect(serializedLogs).not.toContain('user@example.com');
  });

  it('safe logs do not include raw prompt, raw anonymizer response, or placeholder map', async () => {
    const rawAnonymizerResponse = anonymizedEmailResponse(baseRequest.messages);
    anonymizerProvider.anonymize.mockResolvedValueOnce(rawAnonymizerResponse);

    await service.chat({
      ...baseRequest,
      messages: [{ role: 'user', content: 'Email user@example.com' }],
    });

    const serializedLogs = serializeLogs();
    expect(serializedLogs).not.toContain('Email user@example.com');
    expect(serializedLogs).not.toContain('user@example.com');
    expect(serializedLogs).not.toContain(rawAnonymizerResponse);
    expect(serializedLogs).not.toContain('placeholderMap');
  });

  it('success path logs a safe AI flow monitoring event with latency', async () => {
    await service.chat(baseRequest);

    expect(loggerLogSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: AiMonitoringEventName.AiFlowSucceeded,
        operation: AiMonitoringOperation.LlmChat,
        stage: AiMonitoringStage.AiFlow,
        status: AiMonitoringStatus.Success,
        latencyMs: expect.any(Number),
        providerAlias: 'primary',
        modelAlias: 'mock-llm-v1',
        providerConfigured: true,
      }),
    );
  });

  it('returns no_pii effective class when anonymizer finds no entities', async () => {
    const response = await service.chat(baseRequest);

    expect(response.dataClass).toBe(DataClass.NoPii);
  });

  it('returns high_sensitive for high-sensitive anonymizer entities on safe mock provider', async () => {
    anonymizerProvider.anonymize.mockResolvedValueOnce(
      JSON.stringify({
        messages: [{ role: 'user', content: 'SNILS {{PII_SNILS_0001}}' }],
        entities: [
          {
            placeholder: '{{PII_SNILS_0001}}',
            type: 'snils',
            description: 'SNILS',
          },
        ],
        placeholderMap: {
          '{{PII_SNILS_0001}}': '123-456-789 00',
        },
        stats: { snils: 1 },
      }),
    );

    const response = await service.chat(baseRequest);

    expect(response.dataClass).toBe(DataClass.HighSensitive);
  });

  it('blocks high_sensitive for external provider hook', async () => {
    (provider as unknown as { isExternal: boolean }).isExternal = true;
    anonymizerProvider.anonymize.mockResolvedValueOnce(
      JSON.stringify({
        messages: [{ role: 'user', content: 'Card {{PII_BANK_CARD_0001}}' }],
        entities: [
          {
            placeholder: '{{PII_BANK_CARD_0001}}',
            type: 'bank_card',
            description: 'bank card',
          },
        ],
        placeholderMap: {
          '{{PII_BANK_CARD_0001}}': '4111 1111 1111 1111',
        },
        stats: { bank_card: 1 },
      }),
    );
    const chatSpy = jest.spyOn(provider, 'chat');

    await expect(service.chat(baseRequest)).rejects.toThrow(
      new ForbiddenException('LLM request blocked by data policy'),
    );
    expect(chatSpy).not.toHaveBeenCalled();
  });

  it('blocks provider when policy does not allow mock', async () => {
    await expect(
      service.chat({
        ...baseRequest,
        policy: { providers: [] },
      }),
    ).rejects.toThrow(
      new ForbiddenException('LLM provider is not allowed by policy'),
    );
  });

  it('main provider timeout returns a safe timeout error', async () => {
    process.env.LLM_PROVIDER_MAX_ATTEMPTS = '1';
    process.env.LLM_PROVIDER_TIMEOUT_MS = '1';
    jest.spyOn(provider, 'chat').mockReturnValueOnce(new Promise(() => {}));

    await expect(service.chat(baseRequest)).rejects.toThrow(
      new GatewayTimeoutException('LLM provider timed out'),
    );

    const serializedLogs = serializeLogs();
    expect(serializedLogs).toContain('AI_PROVIDER_TIMEOUT');
    expect(serializedLogs).toContain('AI_FLOW_FAILED');
    expect(serializedLogs).toContain('AI_STAGE_FAILED');
    expect(serializedLogs).not.toContain('Summarize public information');
  });

  it('retries transient main provider network errors', async () => {
    const chatSpy = jest
      .spyOn(provider, 'chat')
      .mockRejectedValueOnce(new TypeError('network secret user@example.com'))
      .mockResolvedValueOnce({
        content: 'Recovered response',
        usage: usage(),
      });

    const response = await service.chat(baseRequest);

    expect(response.content).toBe('Recovered response');
    expect(chatSpy).toHaveBeenCalledTimes(2);
  });

  it.each([500, 429])(
    'retries transient main provider HTTP %s errors',
    async (status) => {
      const chatSpy = jest
        .spyOn(provider, 'chat')
        .mockRejectedValueOnce(
          Object.assign(new Error(`HTTP ${status} raw provider body`), {
            status,
          }),
        )
        .mockResolvedValueOnce({
          content: 'Recovered response',
          usage: usage(),
        });

      await service.chat(baseRequest);

      expect(chatSpy).toHaveBeenCalledTimes(2);
    },
  );

  it('uses exponential backoff delay between main provider retries', async () => {
    process.env.LLM_PROVIDER_BACKOFF_BASE_MS = '7';
    process.env.LLM_PROVIDER_BACKOFF_MAX_MS = '20';
    const timeoutSpy = jest.spyOn(global, 'setTimeout');
    jest
      .spyOn(provider, 'chat')
      .mockRejectedValueOnce(new TypeError('temporary network failure'))
      .mockResolvedValueOnce({
        content: 'Recovered response',
        usage: usage(),
      });

    await service.chat(baseRequest);

    expect(timeoutSpy).toHaveBeenCalledWith(expect.any(Function), 7);
  });

  it('does not retry validation errors', async () => {
    const chatSpy = jest.spyOn(provider, 'chat');

    await expect(
      service.chat({
        ...baseRequest,
        messages: [],
      }),
    ).rejects.toThrow(new BadRequestException('LLM request validation failed'));
    expect(chatSpy).not.toHaveBeenCalled();
  });

  it('does not retry policy/security errors', async () => {
    const chatSpy = jest.spyOn(provider, 'chat');

    await expect(
      service.chat({
        ...baseRequest,
        policy: { providers: [] },
      }),
    ).rejects.toThrow(
      new ForbiddenException('LLM provider is not allowed by policy'),
    );
    expect(chatSpy).not.toHaveBeenCalled();
  });

  it('does not retry anonymizer errors', async () => {
    anonymizerProvider.anonymize.mockRejectedValueOnce(
      new Error('dirty anonymizer failure user@example.com'),
    );
    const chatSpy = jest.spyOn(provider, 'chat');

    await expect(service.chat(baseRequest)).rejects.toThrow(
      new ForbiddenException('LLM request blocked by data policy'),
    );
    expect(anonymizerProvider.anonymize).toHaveBeenCalledTimes(1);
    expect(chatSpy).not.toHaveBeenCalled();
  });

  it('does not retry restore errors', async () => {
    anonymizerProvider.anonymize.mockResolvedValueOnce(
      anonymizedEmailResponse(baseRequest.messages),
    );
    const chatSpy = jest.spyOn(provider, 'chat').mockResolvedValueOnce({
      content: 'Unknown {{PII_PHONE_0001}}',
      usage: usage(),
    });

    await expect(service.chat(baseRequest)).rejects.toThrow(
      new BadRequestException('LLM response restore failed'),
    );
    expect(chatSpy).toHaveBeenCalledTimes(1);
  });

  it('does not use fallback when fallback is disabled by default', async () => {
    process.env.LLM_PROVIDER_MAX_ATTEMPTS = '1';
    jest
      .spyOn(provider, 'chat')
      .mockRejectedValueOnce(new TypeError('primary unavailable'));
    const fallbackSpy = jest.spyOn(fallbackOpenAICompatibleProvider, 'chat');

    await expect(service.chat(baseRequest)).rejects.toThrow(
      new ServiceUnavailableException('LLM provider is unavailable'),
    );
    expect(fallbackSpy).not.toHaveBeenCalled();
  });

  it('fallback disabled allows empty fallback provider config', async () => {
    process.env.LLM_FALLBACK_ENABLED = 'false';
    delete process.env.LLM_FALLBACK_PROVIDER;
    delete process.env.LLM_FALLBACK_MODEL_ALIAS;
    delete process.env.LLM_FALLBACK_OPENAI_COMPATIBLE_BASE_URL;
    delete process.env.LLM_FALLBACK_OPENAI_COMPATIBLE_API_KEY;
    delete process.env.LLM_FALLBACK_OPENAI_COMPATIBLE_CHAT_MODEL;

    const response = await service.chat(baseRequest);

    expect(response.content).toBe('Mock LLM response');
  });

  it('fallback enabled with missing fallback config fails safely before primary provider call', async () => {
    process.env.LLM_PROVIDER_MAX_ATTEMPTS = '1';
    process.env.LLM_FALLBACK_ENABLED = 'true';
    delete process.env.LLM_FALLBACK_OPENAI_COMPATIBLE_API_KEY;
    const primarySpy = jest.spyOn(provider, 'chat').mockResolvedValueOnce({
      content: 'Primary response',
      usage: usage(),
    });
    const fallbackSpy = jest.spyOn(fallbackOpenAICompatibleProvider, 'chat');

    await expect(service.chat(baseRequest)).rejects.toThrow(
      new ServiceUnavailableException('LLM provider configuration is invalid'),
    );
    expect(primarySpy).not.toHaveBeenCalled();
    expect(fallbackSpy).not.toHaveBeenCalled();

    const serializedLogs = serializeLogs();
    expect(serializedLogs).toContain('AI_PROVIDER_CONFIG_INVALID');
    expect(serializedLogs).not.toContain('fallback-secret-key');
    expect(serializedLogs).not.toContain('real-fallback-chat-model');
    expect(serializedLogs).not.toContain('https://fallback-provider.test');
  });

  it('uses fallback model alias when enabled and primary fails transiently', async () => {
    process.env.LLM_PROVIDER_MAX_ATTEMPTS = '1';
    process.env.LLM_FALLBACK_ENABLED = 'true';
    jest
      .spyOn(provider, 'chat')
      .mockRejectedValueOnce(new TypeError('primary unavailable'));
    const fallbackSpy = jest
      .spyOn(fallbackOpenAICompatibleProvider, 'chat')
      .mockResolvedValueOnce({
        content: 'Fallback response',
        usage: usage(),
      });

    const response = await service.chat(baseRequest);

    expect(response.content).toBe('Fallback response');
    expect(response.modelId).toBe('chat-fallback');
    expect(fallbackSpy).toHaveBeenCalledTimes(1);
  });

  it('selects primary and fallback adapters by provider role when aliases collide', async () => {
    process.env.LLM_PROVIDER_MAX_ATTEMPTS = '1';
    process.env.LLM_FALLBACK_ENABLED = 'true';
    process.env.LLM_PRIMARY_PROVIDER = LlmProvider.OpenAICompatible;
    process.env.LLM_PRIMARY_MODEL_ALIAS = 'shared-chat-alias';
    process.env.LLM_FALLBACK_MODEL_ALIAS = 'shared-chat-alias';
    openAICompatibleProvider.modelId = 'shared-chat-alias';
    fallbackOpenAICompatibleProvider.modelId = 'shared-chat-alias';
    const primarySpy = jest
      .spyOn(openAICompatibleProvider, 'chat')
      .mockRejectedValueOnce(new TypeError('primary unavailable'));
    const fallbackSpy = jest
      .spyOn(fallbackOpenAICompatibleProvider, 'chat')
      .mockResolvedValueOnce({
        content: 'Fallback selected by role',
        usage: usage(),
      });

    const response = await service.chat(baseRequest);

    expect(response.content).toBe('Fallback selected by role');
    expect(response.modelId).toBe('shared-chat-alias');
    expect(primarySpy).toHaveBeenCalledTimes(1);
    expect(fallbackSpy).toHaveBeenCalledTimes(1);

    const serializedLogs = serializeLogs();
    expect(serializedLogs).toContain('primary');
    expect(serializedLogs).toContain('fallback');
    expect(serializedLogs).not.toContain('fallback-secret-key');
    expect(serializedLogs).not.toContain('real-fallback-chat-model');
    expect(serializedLogs).not.toContain('https://fallback-provider.test');
  });

  it.each([
    [
      'timeout',
      new AiError('AI_PROVIDER_TIMEOUT', 'provider_timeout', {
        retryable: true,
        fallbackEligible: true,
      }),
    ],
    ['network unavailable', new TypeError('primary network unavailable')],
    ['5xx', Object.assign(new Error('raw provider 500 body'), { status: 500 })],
    ['429', Object.assign(new Error('raw provider 429 body'), { status: 429 })],
  ])(
    'uses fallback after primary transient %s failure',
    async (_name, error) => {
      process.env.LLM_PROVIDER_MAX_ATTEMPTS = '1';
      process.env.LLM_FALLBACK_ENABLED = 'true';
      jest.spyOn(provider, 'chat').mockRejectedValueOnce(error);
      const fallbackSpy = jest
        .spyOn(fallbackOpenAICompatibleProvider, 'chat')
        .mockResolvedValueOnce({
          content: 'Fallback response',
          usage: usage(),
        });

      const response = await service.chat(baseRequest);

      expect(response.content).toBe('Fallback response');
      expect(response.providerId).toBe(LlmProvider.OpenAICompatible);
      expect(response.modelId).toBe('chat-fallback');
      expect(fallbackSpy).toHaveBeenCalledTimes(1);
    },
  );

  it('does not use fallback for primary provider config errors', async () => {
    process.env.LLM_PROVIDER_MAX_ATTEMPTS = '1';
    process.env.LLM_FALLBACK_ENABLED = 'true';
    jest.spyOn(openAICompatibleProvider, 'chat').mockRejectedValueOnce(
      new AiError('AI_PROVIDER_CONFIG_INVALID', 'provider_config_invalid', {
        retryable: false,
        fallbackEligible: false,
      }),
    );
    process.env.LLM_PRIMARY_PROVIDER = LlmProvider.OpenAICompatible;
    process.env.LLM_PRIMARY_MODEL_ALIAS = 'chat-default';
    const fallbackSpy = jest.spyOn(fallbackOpenAICompatibleProvider, 'chat');

    await expect(service.chat(baseRequest)).rejects.toThrow(
      new ServiceUnavailableException('LLM provider configuration is invalid'),
    );
    expect(fallbackSpy).not.toHaveBeenCalled();
  });

  it('uses fallback-specific retry and backoff settings', async () => {
    process.env.LLM_PROVIDER_MAX_ATTEMPTS = '1';
    process.env.LLM_PROVIDER_BACKOFF_BASE_MS = '99';
    process.env.LLM_FALLBACK_ENABLED = 'true';
    process.env.LLM_FALLBACK_PROVIDER_MAX_ATTEMPTS = '2';
    process.env.LLM_FALLBACK_PROVIDER_BACKOFF_BASE_MS = '7';
    process.env.LLM_FALLBACK_PROVIDER_BACKOFF_MAX_MS = '7';
    const timeoutSpy = jest.spyOn(global, 'setTimeout');
    jest
      .spyOn(provider, 'chat')
      .mockRejectedValueOnce(new TypeError('primary unavailable'));
    const fallbackSpy = jest
      .spyOn(fallbackOpenAICompatibleProvider, 'chat')
      .mockRejectedValueOnce(new TypeError('fallback network unavailable'))
      .mockResolvedValueOnce({
        content: 'Fallback recovered response',
        usage: usage(),
      });

    const response = await service.chat(baseRequest);

    expect(response.content).toBe('Fallback recovered response');
    expect(fallbackSpy).toHaveBeenCalledTimes(2);
    expect(timeoutSpy).toHaveBeenCalledWith(expect.any(Function), 7);
  });

  it('does not use fallback for restore errors', async () => {
    process.env.LLM_FALLBACK_ENABLED = 'true';
    anonymizerProvider.anonymize.mockResolvedValueOnce(
      anonymizedEmailResponse(baseRequest.messages),
    );
    jest.spyOn(provider, 'chat').mockResolvedValueOnce({
      content: 'Unknown {{PII_PHONE_0001}}',
      usage: usage(),
    });
    const fallbackSpy = jest.spyOn(fallbackOpenAICompatibleProvider, 'chat');

    await expect(service.chat(baseRequest)).rejects.toThrow(
      new BadRequestException('LLM response restore failed'),
    );
    expect(fallbackSpy).not.toHaveBeenCalled();
  });

  it('blocks fallback when fallback model is not allowed', async () => {
    process.env.LLM_PROVIDER_MAX_ATTEMPTS = '1';
    process.env.LLM_FALLBACK_ENABLED = 'true';
    process.env.LLM_FALLBACK_MODEL_ALIAS = 'chat-fallback';
    process.env.LLM_FALLBACK_MODEL = 'mock-fallback-v1';
    process.env.LLM_ALLOWED_MODEL_ALIASES = 'mock-llm-v1';
    jest
      .spyOn(provider, 'chat')
      .mockRejectedValueOnce(new TypeError('primary unavailable'));
    const fallbackSpy = jest.spyOn(fallbackOpenAICompatibleProvider, 'chat');

    await expect(service.chat(baseRequest)).rejects.toThrow(
      new ForbiddenException('LLM model is not allowed by policy'),
    );
    expect(fallbackSpy).not.toHaveBeenCalled();
  });

  it('blocks unsupported primary provider/model safely', async () => {
    process.env.LLM_PRIMARY_MODEL_ALIAS = 'missing-model';
    const chatSpy = jest.spyOn(provider, 'chat');

    await expect(service.chat(baseRequest)).rejects.toThrow(
      new ForbiddenException('LLM model is not allowed by policy'),
    );
    expect(chatSpy).not.toHaveBeenCalled();
  });

  it('can select openai_compatible provider by safe aliases', async () => {
    process.env.LLM_PRIMARY_PROVIDER = LlmProvider.OpenAICompatible;
    process.env.LLM_PRIMARY_MODEL_ALIAS = 'chat-default';

    const response = await service.chat(baseRequest);

    expect(response.content).toBe('OpenAI-compatible response');
    expect(openAICompatibleProvider.chat).toHaveBeenCalledTimes(1);
  });

  it('safe logs across retry and fallback do not include raw payloads', async () => {
    process.env.LLM_PROVIDER_MAX_ATTEMPTS = '1';
    process.env.LLM_FALLBACK_ENABLED = 'true';
    anonymizerProvider.anonymize.mockResolvedValueOnce(
      anonymizedEmailResponse(baseRequest.messages),
    );
    jest
      .spyOn(provider, 'chat')
      .mockRejectedValueOnce(
        Object.assign(
          new Error(
            'https://provider.test Authorization Bearer secret body user@example.com placeholderMap',
          ),
          { status: 500 },
        ),
      );
    jest.spyOn(fallbackOpenAICompatibleProvider, 'chat').mockResolvedValueOnce({
      content: 'Email {{PII_EMAIL_0001}}',
      usage: usage(),
    });

    await service.chat({
      ...baseRequest,
      messages: [{ role: 'user', content: 'Email user@example.com' }],
    });

    const serializedLogs = serializeLogs();
    expect(serializedLogs).toContain('AI_FALLBACK_ATTEMPTED');
    expect(serializedLogs).toContain('AI_FALLBACK_SUCCEEDED');
    expect(serializedLogs).toContain('fallbackUsed');
    expect(serializedLogs).toContain('attempt');
    expect(serializedLogs).not.toContain('https://provider.test');
    expect(serializedLogs).not.toContain('Authorization');
    expect(serializedLogs).not.toContain('secret');
    expect(serializedLogs).not.toContain('Email user@example.com');
    expect(serializedLogs).not.toContain('placeholderMap');
  });

  it('failure monitoring does not include raw provider error body or endpoint fields', async () => {
    process.env.LLM_PROVIDER_MAX_ATTEMPTS = '1';
    jest
      .spyOn(provider, 'chat')
      .mockRejectedValueOnce(
        Object.assign(
          new Error(
            'raw provider body https://provider.test Authorization Bearer secret user@example.com',
          ),
          { status: 500 },
        ),
      );

    await expect(service.chat(baseRequest)).rejects.toThrow(
      new ServiceUnavailableException('LLM provider is unavailable'),
    );

    const serializedLogs = serializeLogs();
    expect(serializedLogs).toContain('AI_PROVIDER_HTTP_5XX');
    expect(serializedLogs).not.toContain('raw provider body');
    expect(serializedLogs).not.toContain('https://provider.test');
    expect(serializedLogs).not.toContain('Authorization');
    expect(serializedLogs).not.toContain('secret');
    expect(serializedLogs).not.toContain('user@example.com');
    expect(serializedLogs).not.toContain('baseUrl');
    expect(serializedLogs).not.toContain('endpoint');
  });

  it('blocks raw PII in provider response before restore', async () => {
    jest.spyOn(provider, 'chat').mockResolvedValueOnce({
      content: 'New email leak@example.com',
      usage: usage(),
    });

    await expect(service.chat(baseRequest)).rejects.toThrow(
      new ForbiddenException('LLM request blocked by data policy'),
    );
  });

  it('does not cache provider responses rejected by output PII scan', async () => {
    process.env.LLM_ANONYMIZATION_MODE = AnonymizationMode.DisabledForNoPii;
    const cachedRequest = {
      ...baseRequest,
      declaredDataClass: DataClass.NoPii,
      policy: { cacheTtlMs: 60_000 },
    };
    const chatSpy = jest
      .spyOn(provider, 'chat')
      .mockResolvedValueOnce({
        content: 'New email leak@example.com',
        usage: usage(),
      })
      .mockResolvedValueOnce({
        content: 'Safe response',
        usage: usage(),
      });
    const cacheWriteSpy = jest.spyOn(aiCache, 'write');

    await expect(service.chat(cachedRequest)).rejects.toThrow(
      new ForbiddenException('LLM request blocked by data policy'),
    );

    const response = await service.chat(cachedRequest);

    expect(response.content).toBe('Safe response');
    expect(response.cacheHit).toBe(false);
    expect(chatSpy).toHaveBeenCalledTimes(2);
    expect(cacheWriteSpy).toHaveBeenCalledTimes(1);
  });

  it('does not leak restored PII across structurally identical anonymized requests', async () => {
    const firstEmail = 'first.person@example.com';
    const secondEmail = 'second.person@example.com';
    anonymizerProvider.anonymize.mockImplementation(
      ({ messages }: { messages: LlmMessage[] }) =>
        anonymizedEmailResponse(
          messages,
          messages[0].content.includes(firstEmail) ? firstEmail : secondEmail,
        ),
    );
    const chatSpy = jest
      .spyOn(provider, 'chat')
      .mockResolvedValueOnce({
        content: 'Email: {{PII_EMAIL_0001}}',
        usage: usage(),
      })
      .mockResolvedValueOnce({
        content: 'Second email: {{PII_EMAIL_0001}}',
        usage: usage(),
      });
    const cacheWriteSpy = jest.spyOn(aiCache, 'write');
    const request = {
      ...baseRequest,
      policy: { cacheTtlMs: 60_000 },
    };

    const firstResponse = await service.chat({
      ...request,
      messages: [{ role: 'user', content: `Email ${firstEmail}` }],
    });
    const secondResponse = await service.chat({
      ...request,
      messages: [{ role: 'user', content: `Email ${secondEmail}` }],
    });

    expect(firstResponse.content).toBe(`Email: ${firstEmail}`);
    expect(secondResponse.content).toBe(`Second email: ${secondEmail}`);
    expect(secondResponse.content).not.toContain(firstEmail);
    expect(firstResponse.cacheHit).toBeUndefined();
    expect(secondResponse.cacheHit).toBeUndefined();
    expect(chatSpy).toHaveBeenCalledTimes(2);
    expect(cacheWriteSpy).not.toHaveBeenCalled();
  });

  it('skips every cache operation for anonymized and restored PII', async () => {
    anonymizerProvider.anonymize.mockResolvedValueOnce(
      anonymizedEmailResponse(baseRequest.messages),
    );
    jest.spyOn(provider, 'chat').mockResolvedValueOnce({
      content: 'Email: {{PII_EMAIL_0001}}',
      usage: usage(),
    });
    const buildKeySpy = jest.spyOn(aiCache, 'buildKey');
    const cacheReadSpy = jest.spyOn(aiCache, 'read');
    const cacheWriteSpy = jest.spyOn(aiCache, 'write');

    const response = await service.chat({
      ...baseRequest,
      policy: { cacheTtlMs: 60_000 },
    });

    expect(response.content).toBe('Email: user@example.com');
    expect(response.cacheKey).toBeUndefined();
    expect(response.cacheHit).toBeUndefined();
    expect(buildKeySpy).not.toHaveBeenCalled();
    expect(cacheReadSpy).not.toHaveBeenCalled();
    expect(cacheWriteSpy).not.toHaveBeenCalled();
  });

  it.each([AnonymizationMode.DisabledForNoPii, AnonymizationMode.Disabled])(
    'caches repeated explicit no_pii requests in %s mode',
    async (anonymizationMode) => {
      process.env.LLM_ANONYMIZATION_MODE = anonymizationMode;
      const chatSpy = jest.spyOn(provider, 'chat').mockResolvedValue({
        content: 'Safe public response',
        usage: usage(),
      });
      const cacheWriteSpy = jest.spyOn(aiCache, 'write');
      const request = {
        ...baseRequest,
        declaredDataClass: DataClass.NoPii,
        policy: { cacheTtlMs: 60_000 },
      };

      const firstResponse = await service.chat(request);
      const secondResponse = await service.chat(request);

      expect(firstResponse.cacheHit).toBe(false);
      expect(secondResponse.cacheHit).toBe(true);
      expect(secondResponse.content).toBe('Safe public response');
      expect(secondResponse.cacheKey).toBe(firstResponse.cacheKey);
      expect(anonymizerProvider.anonymize).not.toHaveBeenCalled();
      expect(chatSpy).toHaveBeenCalledTimes(1);
      expect(cacheWriteSpy).toHaveBeenCalledTimes(1);
    },
  );

  it.each([undefined, 0, -1, Number.POSITIVE_INFINITY, Number.NaN])(
    'does not cache explicit no_pii requests with unsafe TTL %s',
    async (cacheTtlMs) => {
      process.env.LLM_ANONYMIZATION_MODE = AnonymizationMode.DisabledForNoPii;
      const chatSpy = jest.spyOn(provider, 'chat').mockResolvedValue({
        content: 'Safe public response',
        usage: usage(),
      });
      const buildKeySpy = jest.spyOn(aiCache, 'buildKey');
      const cacheReadSpy = jest.spyOn(aiCache, 'read');
      const cacheWriteSpy = jest.spyOn(aiCache, 'write');
      const request = {
        ...baseRequest,
        declaredDataClass: DataClass.NoPii,
        policy: { cacheTtlMs },
      };

      const firstResponse = await service.chat(request);
      const secondResponse = await service.chat(request);

      expect(firstResponse.cacheHit).toBeUndefined();
      expect(secondResponse.cacheHit).toBeUndefined();
      expect(chatSpy).toHaveBeenCalledTimes(2);
      expect(buildKeySpy).not.toHaveBeenCalled();
      expect(cacheReadSpy).not.toHaveBeenCalled();
      expect(cacheWriteSpy).not.toHaveBeenCalled();
    },
  );

  it('disables cache in required mode even when anonymizer returns no_pii', async () => {
    const chatSpy = jest.spyOn(provider, 'chat').mockResolvedValue({
      content: 'Safe public response',
      usage: usage(),
    });
    const buildKeySpy = jest.spyOn(aiCache, 'buildKey');
    const cacheReadSpy = jest.spyOn(aiCache, 'read');
    const cacheWriteSpy = jest.spyOn(aiCache, 'write');
    const request = {
      ...baseRequest,
      declaredDataClass: DataClass.NoPii,
      policy: { cacheTtlMs: 60_000 },
    };

    const firstResponse = await service.chat(request);
    const secondResponse = await service.chat(request);

    expect(firstResponse.dataClass).toBe(DataClass.NoPii);
    expect(firstResponse.cacheHit).toBeUndefined();
    expect(secondResponse.cacheHit).toBeUndefined();
    expect(anonymizerProvider.anonymize).toHaveBeenCalledTimes(2);
    expect(chatSpy).toHaveBeenCalledTimes(2);
    expect(buildKeySpy).not.toHaveBeenCalled();
    expect(cacheReadSpy).not.toHaveBeenCalled();
    expect(cacheWriteSpy).not.toHaveBeenCalled();
  });

  it('does not cache restore failures and calls provider again', async () => {
    anonymizerProvider.anonymize.mockResolvedValue(
      anonymizedEmailResponse(baseRequest.messages),
    );
    const chatSpy = jest.spyOn(provider, 'chat').mockResolvedValue({
      content: 'Unknown {{PII_PHONE_0001}}',
      usage: usage(),
    });
    const cacheWriteSpy = jest.spyOn(aiCache, 'write');
    const request = {
      ...baseRequest,
      policy: { cacheTtlMs: 60_000 },
    };

    await expect(service.chat(request)).rejects.toThrow(
      new BadRequestException('LLM response restore failed'),
    );
    await expect(service.chat(request)).rejects.toThrow(
      new BadRequestException('LLM response restore failed'),
    );

    expect(chatSpy).toHaveBeenCalledTimes(2);
    expect(cacheWriteSpy).not.toHaveBeenCalled();
  });

  it('preserves fallback and safe cache behavior for explicit no_pii requests', async () => {
    process.env.LLM_ANONYMIZATION_MODE = AnonymizationMode.DisabledForNoPii;
    process.env.LLM_PROVIDER_MAX_ATTEMPTS = '1';
    process.env.LLM_FALLBACK_ENABLED = 'true';
    const primarySpy = jest
      .spyOn(provider, 'chat')
      .mockRejectedValue(new TypeError('primary unavailable'));
    const fallbackSpy = jest
      .spyOn(fallbackOpenAICompatibleProvider, 'chat')
      .mockResolvedValue({
        content: 'Safe fallback response',
        usage: usage(),
      });
    const request = {
      ...baseRequest,
      declaredDataClass: DataClass.NoPii,
      policy: { cacheTtlMs: 60_000 },
    };

    const firstResponse = await service.chat(request);
    const secondResponse = await service.chat(request);

    expect(firstResponse.content).toBe('Safe fallback response');
    expect(firstResponse.cacheHit).toBe(false);
    expect(secondResponse.content).toBe('Safe fallback response');
    expect(secondResponse.cacheHit).toBe(true);
    expect(primarySpy).toHaveBeenCalledTimes(2);
    expect(fallbackSpy).toHaveBeenCalledTimes(1);
  });

  it('preserves fallback without caching anonymized PII responses', async () => {
    process.env.LLM_PROVIDER_MAX_ATTEMPTS = '1';
    process.env.LLM_FALLBACK_ENABLED = 'true';
    anonymizerProvider.anonymize.mockImplementation(
      ({ messages }: { messages: LlmMessage[] }) =>
        anonymizedEmailResponse(messages),
    );
    const primarySpy = jest
      .spyOn(provider, 'chat')
      .mockRejectedValue(new TypeError('primary unavailable'));
    const fallbackSpy = jest
      .spyOn(fallbackOpenAICompatibleProvider, 'chat')
      .mockResolvedValue({
        content: 'Email: {{PII_EMAIL_0001}}',
        usage: usage(),
      });
    const cacheWriteSpy = jest.spyOn(aiCache, 'write');
    const request = {
      ...baseRequest,
      messages: [{ role: 'user' as const, content: 'Email user@example.com' }],
      policy: { cacheTtlMs: 60_000 },
    };

    const firstResponse = await service.chat(request);
    const secondResponse = await service.chat(request);

    expect(firstResponse.content).toBe('Email: user@example.com');
    expect(secondResponse.content).toBe('Email: user@example.com');
    expect(firstResponse.cacheHit).toBeUndefined();
    expect(secondResponse.cacheHit).toBeUndefined();
    expect(primarySpy).toHaveBeenCalledTimes(2);
    expect(fallbackSpy).toHaveBeenCalledTimes(2);
    expect(cacheWriteSpy).not.toHaveBeenCalled();
  });

  it('uses generic validation errors', async () => {
    await expect(
      service.chat({
        ...baseRequest,
        messages: [],
      }),
    ).rejects.toThrow(new BadRequestException('LLM request validation failed'));
  });

  it('.env.example documents anonymization modes and trusted-mode responsibility', () => {
    const envExample = readFileSync('.env.example', 'utf8');

    expect(envExample).toContain('LLM_ANONYMIZATION_MODE=required');
    expect(envExample).toContain(
      'required: strict mode for external/untrusted',
    );
    expect(envExample).toContain('disabled_for_no_pii: hybrid mode');
    expect(envExample).toContain('disabled: trusted/internal/legal LLM only');
    expect(envExample).toContain(
      'customer accepts legal and infrastructure responsibility',
    );
  });

  function anonymizedEmailResponse(
    messages: LlmMessage[],
    email = 'user@example.com',
  ): string {
    return JSON.stringify({
      messages: messages.map((message) => ({
        ...message,
        content: 'Email {{PII_EMAIL_0001}}',
      })),
      entities: [
        {
          placeholder: '{{PII_EMAIL_0001}}',
          type: 'email',
          description: 'email address',
        },
      ],
      placeholderMap: {
        '{{PII_EMAIL_0001}}': email,
      },
      stats: { email: 1 },
    });
  }

  function usage() {
    return {
      tokensIn: 1,
      tokensOut: 1,
      costRub: 0,
      latencyMs: 1,
    };
  }

  function serializeLogs(): string {
    return [
      ...loggerLogSpy.mock.calls,
      ...loggerWarnSpy.mock.calls,
      ...loggerErrorSpy.mock.calls,
    ]
      .flat()
      .map((entry) => JSON.stringify(entry))
      .join(' ');
  }

  function snapshotEnv(): Record<string, string | undefined> {
    return {
      LLM_ANONYMIZATION_MODE: process.env.LLM_ANONYMIZATION_MODE,
      LLM_PROVIDER_MAX_ATTEMPTS: process.env.LLM_PROVIDER_MAX_ATTEMPTS,
      LLM_PROVIDER_BACKOFF_BASE_MS: process.env.LLM_PROVIDER_BACKOFF_BASE_MS,
      LLM_PROVIDER_BACKOFF_MAX_MS: process.env.LLM_PROVIDER_BACKOFF_MAX_MS,
      LLM_PROVIDER_TIMEOUT_MS: process.env.LLM_PROVIDER_TIMEOUT_MS,
      LLM_PRIMARY_PROVIDER: process.env.LLM_PRIMARY_PROVIDER,
      LLM_PRIMARY_MODEL_ALIAS: process.env.LLM_PRIMARY_MODEL_ALIAS,
      LLM_FALLBACK_ENABLED: process.env.LLM_FALLBACK_ENABLED,
      LLM_FALLBACK_PROVIDER: process.env.LLM_FALLBACK_PROVIDER,
      LLM_FALLBACK_MODEL: process.env.LLM_FALLBACK_MODEL,
      LLM_FALLBACK_MODEL_ALIAS: process.env.LLM_FALLBACK_MODEL_ALIAS,
      LLM_FALLBACK_OPENAI_COMPATIBLE_BASE_URL:
        process.env.LLM_FALLBACK_OPENAI_COMPATIBLE_BASE_URL,
      LLM_FALLBACK_OPENAI_COMPATIBLE_API_KEY:
        process.env.LLM_FALLBACK_OPENAI_COMPATIBLE_API_KEY,
      LLM_FALLBACK_OPENAI_COMPATIBLE_CHAT_MODEL:
        process.env.LLM_FALLBACK_OPENAI_COMPATIBLE_CHAT_MODEL,
      LLM_FALLBACK_PROVIDER_MAX_ATTEMPTS:
        process.env.LLM_FALLBACK_PROVIDER_MAX_ATTEMPTS,
      LLM_FALLBACK_PROVIDER_BACKOFF_BASE_MS:
        process.env.LLM_FALLBACK_PROVIDER_BACKOFF_BASE_MS,
      LLM_FALLBACK_PROVIDER_BACKOFF_MAX_MS:
        process.env.LLM_FALLBACK_PROVIDER_BACKOFF_MAX_MS,
      LLM_FALLBACK_PROVIDER_TIMEOUT_MS:
        process.env.LLM_FALLBACK_PROVIDER_TIMEOUT_MS,
      LLM_ALLOWED_PROVIDERS: process.env.LLM_ALLOWED_PROVIDERS,
      LLM_ALLOWED_MODEL_ALIASES: process.env.LLM_ALLOWED_MODEL_ALIASES,
    };
  }

  function restoreEnv(snapshot: Record<string, string | undefined>): void {
    for (const [key, value] of Object.entries(snapshot)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
});
