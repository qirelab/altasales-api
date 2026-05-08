import {
  BadRequestException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AgentId } from './enums/agent-id.enum';
import { DataClass } from './enums/data-class.enum';
import { LlmProvider } from './enums/llm-provider.enum';
import { LlmTask } from './enums/llm-task.enum';
import { LlmChatRequest } from './interfaces/llm-chat-request.interface';
import { LlmProxyService } from './llm-proxy.service';
import { PiiAnonymizerService } from './pii-anonymizer.service';
import { MockLlmProvider } from './providers/mock-llm.provider';

describe('LlmProxyService', () => {
  let service: LlmProxyService;
  let provider: MockLlmProvider;
  let loggerLogSpy: jest.SpyInstance;
  let loggerWarnSpy: jest.SpyInstance;
  let loggerErrorSpy: jest.SpyInstance;

  const baseRequest: LlmChatRequest = {
    agentId: AgentId.Chatbot,
    task: LlmTask.Summarize,
    messages: [{ role: 'user', content: 'Summarize public information' }],
  };

  beforeEach(async () => {
    loggerLogSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    loggerWarnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    loggerErrorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation();

    const module: TestingModule = await Test.createTestingModule({
      providers: [LlmProxyService, PiiAnonymizerService, MockLlmProvider],
    }).compile();

    service = module.get(LlmProxyService);
    provider = module.get(MockLlmProvider);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('passes no-PII request to mock provider', async () => {
    const response = await service.chat(baseRequest);

    expect(response.providerId).toBe(LlmProvider.Mock);
    expect(response.modelId).toBe('mock-llm-v1');
    expect(response.content).toBe('Mock LLM response');
    expect(response.dataClass).toBe(DataClass.NoPii);
  });

  it('blocks explicit no_pii when message scan finds PII', async () => {
    await expect(
      service.chat({
        ...baseRequest,
        dataClass: DataClass.NoPii,
        messages: [
          {
            role: 'user',
            content: 'Email user@example.com and phone +7 999 123-45-67',
          },
          { role: 'user', content: 'ИНН 7707083893' },
        ],
      }),
    ).rejects.toThrow(
      new ForbiddenException('LLM request blocked by data policy'),
    );
  });

  it('blocks inferred PII without explicit dataClass fail-closed', async () => {
    const chatSpy = jest.spyOn(provider, 'chat');

    await expect(
      service.chat({
        ...baseRequest,
        messages: [{ role: 'user', content: 'Email user@example.com' }],
      }),
    ).rejects.toThrow(
      new ForbiddenException('LLM request blocked by data policy'),
    );
    expect(chatSpy).not.toHaveBeenCalled();
  });

  it('blocks raw_pii fail-closed', async () => {
    const chatSpy = jest.spyOn(provider, 'chat');

    await expect(
      service.chat({
        ...baseRequest,
        dataClass: DataClass.RawPii,
        messages: [{ role: 'user', content: 'ИНН 7707083893' }],
      }),
    ).rejects.toThrow(
      new ForbiddenException('LLM request blocked by data policy'),
    );
    expect(chatSpy).not.toHaveBeenCalled();
  });

  it('blocks raw_pii without required anonymization fail-closed', async () => {
    await expect(
      service.chat({
        ...baseRequest,
        dataClass: DataClass.RawPii,
        messages: [{ role: 'user', content: 'Email user@example.com' }],
      }),
    ).rejects.toThrow(
      new ForbiddenException('LLM request blocked by data policy'),
    );
  });

  it('blocks unknown fail-closed', async () => {
    await expect(
      service.chat({
        ...baseRequest,
        dataClass: DataClass.Unknown,
      }),
    ).rejects.toThrow(
      new ForbiddenException('LLM request blocked by data policy'),
    );
  });

  it('blocks high_sensitive always', async () => {
    await expect(
      service.chat({
        ...baseRequest,
        dataClass: DataClass.HighSensitive,
      }),
    ).rejects.toThrow(
      new ForbiddenException('LLM request blocked by data policy'),
    );
  });

  it('blocks invalid runtime dataClass with generic validation error', async () => {
    await expect(
      service.chat({
        ...baseRequest,
        dataClass: 'not_a_real_class' as DataClass,
      }),
    ).rejects.toThrow(new BadRequestException('LLM request validation failed'));
  });

  it('returns normalized providerId, modelId, usage and dataClass', async () => {
    const response = await service.chat(baseRequest);

    expect(response).toMatchObject({
      providerId: LlmProvider.Mock,
      modelId: 'mock-llm-v1',
      dataClass: DataClass.NoPii,
    });
    expect(response.usage.tokensIn).toBeGreaterThan(0);
    expect(response.usage.tokensOut).toBeGreaterThan(0);
    expect(response.usage.costRub).toBe(0);
    expect(response.usage.latencyMs).toBeGreaterThanOrEqual(0);
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

  it('blocks raw PII in provider response', async () => {
    jest.spyOn(provider, 'chat').mockResolvedValueOnce({
      content: 'New email leak@example.com',
      usage: {
        tokensIn: 1,
        tokensOut: 1,
        costRub: 0,
        latencyMs: 1,
      },
    });

    await expect(
      service.chat({
        ...baseRequest,
        messages: [{ role: 'user', content: 'Clean public request' }],
      }),
    ).rejects.toThrow(
      new ForbiddenException('LLM request blocked by data policy'),
    );
  });

  it('logs only safe metadata', async () => {
    jest.spyOn(provider, 'chat').mockResolvedValueOnce({
      content: 'Provider secret content',
      usage: {
        tokensIn: 1,
        tokensOut: 1,
        costRub: 0,
        latencyMs: 1,
      },
    });

    await expect(
      service.chat({
        ...baseRequest,
        messages: [
          {
            role: 'user',
            content:
              'Secret prompt user@example.com +7 999 123-45-67 7707083893',
          },
        ],
      }),
    ).rejects.toThrow(
      new ForbiddenException('LLM request blocked by data policy'),
    );

    const serializedLogs = [
      ...loggerLogSpy.mock.calls,
      ...loggerWarnSpy.mock.calls,
      ...loggerErrorSpy.mock.calls,
    ]
      .flat()
      .map((entry) => JSON.stringify(entry))
      .join(' ');

    expect(serializedLogs).not.toContain('Secret prompt');
    expect(serializedLogs).not.toContain('user@example.com');
    expect(serializedLogs).not.toContain('+7 999 123-45-67');
    expect(serializedLogs).not.toContain('7707083893');
    expect(serializedLogs).not.toContain('{{EMAIL_1}}');
    expect(serializedLogs).not.toContain('Provider secret content');
  });

  it('uses generic validation errors', async () => {
    await expect(
      service.chat({
        ...baseRequest,
        messages: [],
      }),
    ).rejects.toThrow(new BadRequestException('LLM request validation failed'));
  });
});
