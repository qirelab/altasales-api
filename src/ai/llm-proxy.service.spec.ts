import {
  BadRequestException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AgentId } from './enums/agent-id.enum';
import { AnonymizationMode } from './enums/anonymization-mode.enum';
import { DataClass } from './enums/data-class.enum';
import { LlmProvider } from './enums/llm-provider.enum';
import { LlmTask } from './enums/llm-task.enum';
import { AnonymizerProvider } from './interfaces/anonymizer-provider.interface';
import { LlmChatRequest } from './interfaces/llm-chat-request.interface';
import { LlmMessage } from './interfaces/llm-message.interface';
import { LlmProxyService } from './llm-proxy.service';
import { PiiAnonymizerService } from './pii-anonymizer.service';
import { AnonymizerLlmProvider } from './providers/anonymizer-llm.provider';
import { MockLlmProvider } from './providers/mock-llm.provider';

describe('LlmProxyService', () => {
  let service: LlmProxyService;
  let provider: MockLlmProvider;
  let anonymizerProvider: { anonymize: jest.Mock };
  let piiAnonymizer: PiiAnonymizerService;
  let loggerLogSpy: jest.SpyInstance;
  let loggerWarnSpy: jest.SpyInstance;
  let loggerErrorSpy: jest.SpyInstance;
  let originalMode: string | undefined;

  const baseRequest: LlmChatRequest = {
    agentId: AgentId.Chatbot,
    task: LlmTask.Summarize,
    messages: [{ role: 'user', content: 'Summarize public information' }],
  };

  beforeEach(async () => {
    originalMode = process.env.LLM_ANONYMIZATION_MODE;
    process.env.LLM_ANONYMIZATION_MODE = AnonymizationMode.Required;

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

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LlmProxyService,
        PiiAnonymizerService,
        MockLlmProvider,
        {
          provide: AnonymizerLlmProvider,
          useValue: anonymizerProvider,
        },
      ],
    }).compile();

    service = module.get(LlmProxyService);
    provider = module.get(MockLlmProvider);
    piiAnonymizer = module.get(PiiAnonymizerService);
  });

  afterEach(() => {
    if (originalMode === undefined) {
      delete process.env.LLM_ANONYMIZATION_MODE;
    } else {
      process.env.LLM_ANONYMIZATION_MODE = originalMode;
    }
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
    await service.chat({
      ...baseRequest,
      declaredDataClass: DataClass.NoPii,
    });

    expect(anonymizerProvider.anonymize).toHaveBeenCalledTimes(1);
  });

  it('mode disabled_for_no_pii lets explicit no_pii skip anonymizer', async () => {
    process.env.LLM_ANONYMIZATION_MODE = AnonymizationMode.DisabledForNoPii;

    await service.chat({
      ...baseRequest,
      declaredDataClass: DataClass.NoPii,
    });

    expect(anonymizerProvider.anonymize).not.toHaveBeenCalled();
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

  it('mode disabled does not treat missing hint as no_pii', async () => {
    process.env.LLM_ANONYMIZATION_MODE = AnonymizationMode.Disabled;

    await expect(service.chat(baseRequest)).rejects.toThrow(
      new ForbiddenException('LLM request blocked by data policy'),
    );
    expect(anonymizerProvider.anonymize).not.toHaveBeenCalled();
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
    anonymizerProvider.anonymize.mockResolvedValueOnce('raw response with map');

    await expect(service.chat(baseRequest)).rejects.toThrow(
      new BadRequestException('LLM request validation failed'),
    );
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
      new BadRequestException('LLM request validation failed'),
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
    anonymizerProvider.anonymize.mockResolvedValueOnce(
      anonymizedEmailResponse(baseRequest.messages),
    );
    jest.spyOn(provider, 'chat').mockRejectedValueOnce(
      new Error(
        'https://api.provider.test Authorization Bearer secret-key body user@example.com',
      ),
    );

    await expect(service.chat(baseRequest)).rejects.toThrow(
      new ForbiddenException('LLM request blocked by data policy'),
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

  it('blocks raw PII in provider response before restore', async () => {
    jest.spyOn(provider, 'chat').mockResolvedValueOnce({
      content: 'New email leak@example.com',
      usage: usage(),
    });

    await expect(service.chat(baseRequest)).rejects.toThrow(
      new ForbiddenException('LLM request blocked by data policy'),
    );
  });

  it('uses generic validation errors', async () => {
    await expect(
      service.chat({
        ...baseRequest,
        messages: [],
      }),
    ).rejects.toThrow(new BadRequestException('LLM request validation failed'));
  });

  function anonymizedEmailResponse(messages: LlmMessage[]): string {
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
        '{{PII_EMAIL_0001}}': 'user@example.com',
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
});
