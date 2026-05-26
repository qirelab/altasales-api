import {
  BadRequestException,
  ForbiddenException,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { AiMonitoringService } from './ai-monitoring.service';
import { DataClass } from './enums/data-class.enum';
import { EmbeddingProxyService } from './embedding-proxy.service';
import { EmbeddingProviderAdapter } from './interfaces/embedding-provider-adapter.interface';

describe('EmbeddingProxyService', () => {
  let service: EmbeddingProxyService;
  let provider: EmbeddingProviderAdapter;
  let loggerLogSpy: jest.SpyInstance;
  let originalEnv: Record<string, string | undefined>;

  beforeEach(() => {
    originalEnv = {
      LLM_EMBEDDING_PROVIDER: process.env.LLM_EMBEDDING_PROVIDER,
      LLM_EMBEDDING_MODEL_ALIAS: process.env.LLM_EMBEDDING_MODEL_ALIAS,
      LLM_ALLOWED_PROVIDERS: process.env.LLM_ALLOWED_PROVIDERS,
      LLM_ALLOWED_MODEL_ALIASES: process.env.LLM_ALLOWED_MODEL_ALIASES,
      LLM_EMBEDDING_TIMEOUT_MS: process.env.LLM_EMBEDDING_TIMEOUT_MS,
      LLM_EMBEDDING_MAX_ATTEMPTS: process.env.LLM_EMBEDDING_MAX_ATTEMPTS,
      LLM_EMBEDDING_BACKOFF_BASE_MS:
        process.env.LLM_EMBEDDING_BACKOFF_BASE_MS,
      LLM_EMBEDDING_BACKOFF_MAX_MS: process.env.LLM_EMBEDDING_BACKOFF_MAX_MS,
    };
    process.env.LLM_EMBEDDING_PROVIDER = 'openai_compatible';
    process.env.LLM_EMBEDDING_MODEL_ALIAS = 'embedding-default';
    process.env.LLM_ALLOWED_PROVIDERS = 'openai_compatible';
    process.env.LLM_ALLOWED_MODEL_ALIASES = 'embedding-default';
    process.env.LLM_EMBEDDING_TIMEOUT_MS = '10000';
    process.env.LLM_EMBEDDING_MAX_ATTEMPTS = '2';
    process.env.LLM_EMBEDDING_BACKOFF_BASE_MS = '1';
    process.env.LLM_EMBEDDING_BACKOFF_MAX_MS = '1';
    loggerLogSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    provider = {
      providerId: 'openai_compatible',
      modelId: 'embedding-default',
      isExternal: true,
      embed: jest.fn().mockResolvedValue({
        vectors: [[0.1, 0.2]],
        usage: { tokensIn: 2, tokensOut: 0, costRub: 0, latencyMs: 1 },
        dimensions: 2,
      }),
    };
    service = new EmbeddingProxyService(
      new AiMonitoringService(),
      {} as never,
      [provider],
    );
  });

  afterEach(() => {
    restoreEnv(originalEnv);
    jest.restoreAllMocks();
  });

  it('embeds safe inputs through the selected provider', async () => {
    const response = await service.embed({
      inputs: ['public chunk'],
      declaredDataClass: DataClass.NoPii,
    });

    expect(response.vectors).toEqual([[0.1, 0.2]]);
    expect(response.providerId).toBe('openai_compatible');
    expect(response.modelId).toBe('embedding-default');
    expect(provider.embed).toHaveBeenCalledTimes(1);
    expect(loggerLogSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'EMBEDDING',
        status: 'SUCCESS',
        inputCount: 1,
        vectorDimensions: 2,
      }),
    );
    const serializedLogs = serializeLogs();
    expect(serializedLogs).not.toContain('public chunk');
    expect(serializedLogs).not.toContain('0.1');
    expect(serializedLogs).not.toContain('0.2');
  });

  it('rejects empty inputs without retrying provider calls', async () => {
    await expect(
      service.embed({ inputs: [], declaredDataClass: DataClass.NoPii }),
    ).rejects.toThrow(BadRequestException);
    expect(provider.embed).not.toHaveBeenCalled();
  });

  it.each([DataClass.RawPii, DataClass.Unknown, DataClass.HighSensitive])(
    'blocks %s for external embedding providers',
    async (dataClass) => {
      await expect(
        service.embed({ inputs: ['private chunk'], declaredDataClass: dataClass }),
      ).rejects.toThrow(ForbiddenException);
      expect(provider.embed).not.toHaveBeenCalled();
    },
  );

  it('allows raw_pii for explicitly internal embedding providers', async () => {
    provider.isExternal = false;

    const response = await service.embed({
      inputs: ['private chunk'],
      declaredDataClass: DataClass.RawPii,
    });

    expect(response.dataClass).toBe(DataClass.RawPii);
    expect(provider.embed).toHaveBeenCalledTimes(1);
  });

  it('still blocks unknown data class for internal embedding providers', async () => {
    provider.isExternal = false;

    await expect(
      service.embed({ inputs: ['private chunk'], declaredDataClass: DataClass.Unknown }),
    ).rejects.toThrow(ForbiddenException);
    expect(provider.embed).not.toHaveBeenCalled();
  });

  it('retries transient provider failures and logs safe metadata', async () => {
    (provider.embed as jest.Mock)
      .mockRejectedValueOnce(new TypeError('network raw private chunk'))
      .mockResolvedValueOnce({
        vectors: [[0.1, 0.2]],
        usage: { tokensIn: 2, tokensOut: 0, latencyMs: 1 },
        dimensions: 2,
      });

    await service.embed({
      inputs: ['private chunk'],
      declaredDataClass: DataClass.NoPii,
    });

    expect(provider.embed).toHaveBeenCalledTimes(2);
    const serializedLogs = serializeLogs();
    expect(serializedLogs).toContain('AI_RETRY_ATTEMPT_FAILED');
    expect(serializedLogs).toContain('attempt');
    expect(serializedLogs).not.toContain('private chunk');
  });

  it('blocks embedding model when it is not in the common model allowlist', async () => {
    process.env.LLM_ALLOWED_MODEL_ALIASES = 'chat-default';

    await expect(
      service.embed({ inputs: ['public chunk'], declaredDataClass: DataClass.NoPii }),
    ).rejects.toThrow(ForbiddenException);
    expect(provider.embed).not.toHaveBeenCalled();
  });

  it('maps provider failures to safe unavailable errors', async () => {
    process.env.LLM_EMBEDDING_MAX_ATTEMPTS = '1';
    (provider.embed as jest.Mock).mockRejectedValueOnce(
      Object.assign(new Error('raw provider body private chunk'), { status: 500 }),
    );

    await expect(
      service.embed({ inputs: ['private chunk'], declaredDataClass: DataClass.NoPii }),
    ).rejects.toThrow(ServiceUnavailableException);

    const serializedLogs = serializeLogs();
    expect(serializedLogs).toContain('AI_PROVIDER_HTTP_5XX');
    expect(serializedLogs).not.toContain('raw provider body');
    expect(serializedLogs).not.toContain('private chunk');
  });

  it('does not leak endpoint, api key, real model, body, or vectors in monitoring logs', async () => {
    process.env.LLM_EMBEDDING_MAX_ATTEMPTS = '1';
    (provider.embed as jest.Mock).mockRejectedValueOnce(
      Object.assign(
        new Error(
          'https://provider.test secret-key real-embedding-model request body [0.1,0.2] private chunk',
        ),
        { status: 500 },
      ),
    );

    await expect(
      service.embed({ inputs: ['private chunk'], declaredDataClass: DataClass.NoPii }),
    ).rejects.toThrow(ServiceUnavailableException);

    const serializedLogs = serializeLogs();
    expect(serializedLogs).toContain('EMBEDDING');
    expect(serializedLogs).not.toContain('https://provider.test');
    expect(serializedLogs).not.toContain('secret-key');
    expect(serializedLogs).not.toContain('real-embedding-model');
    expect(serializedLogs).not.toContain('request body');
    expect(serializedLogs).not.toContain('[0.1,0.2]');
    expect(serializedLogs).not.toContain('private chunk');
  });

  function serializeLogs(): string {
    return loggerLogSpy.mock.calls
      .flat()
      .map((entry) => JSON.stringify(entry))
      .join(' ');
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
