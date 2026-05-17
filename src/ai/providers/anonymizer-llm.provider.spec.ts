import { Logger } from '@nestjs/common';
import { AiMonitoringService } from '../ai-monitoring.service';
import { AiMonitoringEventName } from '../enums/ai-monitoring-event-name.enum';
import { AiMonitoringOperation } from '../enums/ai-monitoring-operation.enum';
import { AiMonitoringStage } from '../enums/ai-monitoring-stage.enum';
import { AiMonitoringStatus } from '../enums/ai-monitoring-status.enum';
import { AnonymizerLlmProvider } from './anonymizer-llm.provider';

describe('AnonymizerLlmProvider', () => {
  let provider: AnonymizerLlmProvider;
  let originalEnv: Record<string, string | undefined>;
  let fetchSpy: jest.SpyInstance;
  let loggerLogSpy: jest.SpyInstance;

  const request = {
    messages: [{ role: 'user' as const, content: 'Email user@example.com' }],
  };

  beforeEach(() => {
    originalEnv = {
      LLM_ANONYMIZER_BASE_URL: process.env.LLM_ANONYMIZER_BASE_URL,
      LLM_ANONYMIZER_API_KEY: process.env.LLM_ANONYMIZER_API_KEY,
      LLM_ANONYMIZER_MODEL: process.env.LLM_ANONYMIZER_MODEL,
      LLM_ANONYMIZER_TIMEOUT_MS: process.env.LLM_ANONYMIZER_TIMEOUT_MS,
      LLM_ANONYMIZER_MAX_ATTEMPTS: process.env.LLM_ANONYMIZER_MAX_ATTEMPTS,
      LLM_ANONYMIZER_BACKOFF_BASE_MS:
        process.env.LLM_ANONYMIZER_BACKOFF_BASE_MS,
      LLM_ANONYMIZER_BACKOFF_MAX_MS: process.env.LLM_ANONYMIZER_BACKOFF_MAX_MS,
      LLM_FALLBACK_ENABLED: process.env.LLM_FALLBACK_ENABLED,
      LLM_FALLBACK_PROVIDER: process.env.LLM_FALLBACK_PROVIDER,
    };
    process.env.LLM_ANONYMIZER_BASE_URL = 'https://anonymizer.test';
    process.env.LLM_ANONYMIZER_API_KEY = 'secret-key';
    process.env.LLM_ANONYMIZER_MODEL = 'pii-anonymizer-v1';
    process.env.LLM_ANONYMIZER_TIMEOUT_MS = '10000';
    process.env.LLM_ANONYMIZER_MAX_ATTEMPTS = '2';
    process.env.LLM_ANONYMIZER_BACKOFF_BASE_MS = '1';
    process.env.LLM_ANONYMIZER_BACKOFF_MAX_MS = '1';
    process.env.LLM_FALLBACK_ENABLED = 'true';
    process.env.LLM_FALLBACK_PROVIDER = 'mock';
    loggerLogSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    provider = new AnonymizerLlmProvider(new AiMonitoringService());
    fetchSpy = jest.spyOn(global, 'fetch');
  });

  afterEach(() => {
    restoreEnv(originalEnv);
    jest.restoreAllMocks();
  });

  it('times out safely', async () => {
    process.env.LLM_ANONYMIZER_TIMEOUT_MS = '1';
    process.env.LLM_ANONYMIZER_MAX_ATTEMPTS = '1';
    fetchSpy.mockReturnValueOnce(new Promise(() => {}));

    await expect(provider.anonymize(request)).rejects.toThrow(
      'anonymizer_unavailable',
    );
  });

  it('retries transient fetch failures', async () => {
    fetchSpy
      .mockRejectedValueOnce(new TypeError('network raw user@example.com'))
      .mockResolvedValueOnce(okResponse('{"messages":[]}'));

    const response = await provider.anonymize(request);

    expect(response).toBe('{"messages":[]}');
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(loggerLogSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: AiMonitoringEventName.AiRetryAttemptFailed,
        operation: AiMonitoringOperation.AnonymizerLlm,
        stage: AiMonitoringStage.Retry,
        status: AiMonitoringStatus.Failure,
        attempt: 1,
        maxAttempts: 2,
      }),
    );
  });

  it.each([500, 429])('retries transient HTTP %s responses', async (status) => {
    fetchSpy
      .mockResolvedValueOnce(errorResponse(status))
      .mockResolvedValueOnce(okResponse('{"messages":[]}'));

    await provider.anonymize(request);

    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('fails closed after retry exhaustion without fallback', async () => {
    fetchSpy
      .mockRejectedValueOnce(new TypeError('network raw user@example.com'))
      .mockRejectedValueOnce(new TypeError('network raw user@example.com'));

    await expect(provider.anonymize(request)).rejects.toThrow(
      'anonymizer_unavailable',
    );
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(fetchSpy.mock.calls[0][0]).toBe('https://anonymizer.test');
    expect(fetchSpy.mock.calls[1][0]).toBe('https://anonymizer.test');
    expect(loggerLogSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: AiMonitoringEventName.AiStageFailed,
        operation: AiMonitoringOperation.AnonymizerLlm,
        stage: AiMonitoringStage.ProviderCall,
        status: AiMonitoringStatus.Failure,
        errorCode: 'AI_ANONYMIZATION_FAILED',
      }),
    );
  });

  it('does not leak raw provider errors in thrown errors', async () => {
    fetchSpy.mockRejectedValueOnce(
      new Error(
        'https://provider.test Authorization Bearer secret body user@example.com',
      ),
    );

    await expect(provider.anonymize(request)).rejects.not.toThrow(
      'user@example.com',
    );
  });

  it('does not leak anonymizer URL, headers, body, mode, or raw text in logs', async () => {
    process.env.LLM_ANONYMIZATION_MODE = 'required';
    fetchSpy.mockRejectedValueOnce(
      new Error(
        'https://anonymizer.test Authorization Bearer secret body user@example.com',
      ),
    );

    await expect(provider.anonymize(request)).rejects.toThrow(
      'anonymizer_unavailable',
    );

    const serializedLogs = loggerLogSpy.mock.calls
      .flat()
      .map((entry) => JSON.stringify(entry))
      .join(' ');
    expect(serializedLogs).toContain('ANONYMIZER_LLM');
    expect(serializedLogs).not.toContain('https://anonymizer.test');
    expect(serializedLogs).not.toContain('Authorization');
    expect(serializedLogs).not.toContain('secret');
    expect(serializedLogs).not.toContain('body');
    expect(serializedLogs).not.toContain('user@example.com');
    expect(serializedLogs).not.toContain('required');
    expect(serializedLogs).not.toContain('baseUrl');
    expect(serializedLogs).not.toContain('endpoint');
    expect(serializedLogs).not.toContain('host');
  });

  function okResponse(body: string): Response {
    return {
      ok: true,
      text: jest.fn().mockResolvedValue(body),
    } as unknown as Response;
  }

  function errorResponse(status: number): Response {
    return {
      ok: false,
      status,
      text: jest.fn().mockResolvedValue('raw provider body user@example.com'),
    } as unknown as Response;
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
