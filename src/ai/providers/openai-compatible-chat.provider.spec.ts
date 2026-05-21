import { AiError } from '../errors/ai-error';
import { LlmProvider } from '../enums/llm-provider.enum';
import { OpenAICompatibleChatProviderAdapter } from './openai-compatible-chat.provider';

describe('OpenAICompatibleChatProviderAdapter', () => {
  let provider: OpenAICompatibleChatProviderAdapter;
  let fetchSpy: jest.SpyInstance;
  let originalEnv: Record<string, string | undefined>;

  beforeEach(() => {
    originalEnv = {
      LLM_PRIMARY_MODEL_ALIAS: process.env.LLM_PRIMARY_MODEL_ALIAS,
      LLM_OPENAI_COMPATIBLE_BASE_URL:
        process.env.LLM_OPENAI_COMPATIBLE_BASE_URL,
      LLM_OPENAI_COMPATIBLE_API_KEY: process.env.LLM_OPENAI_COMPATIBLE_API_KEY,
      LLM_OPENAI_COMPATIBLE_CHAT_MODEL:
        process.env.LLM_OPENAI_COMPATIBLE_CHAT_MODEL,
    };
    process.env.LLM_PRIMARY_MODEL_ALIAS = 'chat-default';
    process.env.LLM_OPENAI_COMPATIBLE_BASE_URL = 'https://provider.test';
    process.env.LLM_OPENAI_COMPATIBLE_API_KEY = 'secret-key';
    process.env.LLM_OPENAI_COMPATIBLE_CHAT_MODEL = 'real-chat-model';
    provider = new OpenAICompatibleChatProviderAdapter();
    fetchSpy = jest.spyOn(global, 'fetch');
  });

  afterEach(() => {
    restoreEnv(originalEnv);
    jest.restoreAllMocks();
  });

  it('calls OpenAI-compatible chat completions and normalizes usage', async () => {
    const signal = new AbortController().signal;
    fetchSpy.mockResolvedValueOnce(
      okResponse({
        choices: [{ message: { content: 'Provider response' } }],
        usage: { prompt_tokens: 7, completion_tokens: 3 },
      }),
    );

    const response = await provider.chat(
      [{ role: 'user', content: 'Hello' }],
      { signal },
    );

    expect(provider.providerId).toBe(LlmProvider.OpenAICompatible);
    expect(provider.modelId).toBe('chat-default');
    expect(provider.isExternal).toBe(true);
    expect(response.content).toBe('Provider response');
    expect(response.usage.tokensIn).toBe(7);
    expect(response.usage.tokensOut).toBe(3);
    expect(response.usage.latencyMs).toEqual(expect.any(Number));
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://provider.test/v1/chat/completions',
      expect.objectContaining({ signal }),
    );
  });

  it('fails safely when config is missing', async () => {
    delete process.env.LLM_OPENAI_COMPATIBLE_API_KEY;

    await expect(
      provider.chat([{ role: 'user', content: 'Hello' }]),
    ).rejects.toMatchObject({
      code: 'AI_PROVIDER_UNAVAILABLE',
      message: 'provider_unavailable',
      fallbackEligible: true,
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it.each([500, 429])('throws safe transient HTTP %s errors', async (status) => {
    fetchSpy.mockResolvedValueOnce(errorResponse(status));

    let caught: unknown;
    try {
      await provider.chat([{ role: 'user', content: 'Hello' }]);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(AiError);
    expect(String(caught)).not.toContain('raw provider body');
  });

  it('fails safely on malformed responses', async () => {
    fetchSpy.mockResolvedValueOnce(okResponse({ choices: [] }));

    await expect(
      provider.chat([{ role: 'user', content: 'Hello' }]),
    ).rejects.toMatchObject({
      code: 'AI_PROVIDER_UNAVAILABLE',
      message: 'provider_unavailable',
      fallbackEligible: false,
    });
  });

  it('does not leak baseUrl, apiKey, real model, request body, or response body', async () => {
    fetchSpy.mockResolvedValueOnce(errorResponse(500));

    await expect(
      provider.chat([{ role: 'user', content: 'private prompt' }]),
    ).rejects.not.toThrow(
      'https://provider.test secret-key real-chat-model private prompt raw provider body',
    );
  });

  function okResponse(body: unknown): Response {
    return {
      ok: true,
      json: jest.fn().mockResolvedValue(body),
    } as unknown as Response;
  }

  function errorResponse(status: number): Response {
    return {
      ok: false,
      status,
      text: jest.fn().mockResolvedValue('raw provider body private prompt'),
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
