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
      LLM_FALLBACK_MODEL_ALIAS: process.env.LLM_FALLBACK_MODEL_ALIAS,
      LLM_FALLBACK_OPENAI_COMPATIBLE_BASE_URL:
        process.env.LLM_FALLBACK_OPENAI_COMPATIBLE_BASE_URL,
      LLM_FALLBACK_OPENAI_COMPATIBLE_API_KEY:
        process.env.LLM_FALLBACK_OPENAI_COMPATIBLE_API_KEY,
      LLM_FALLBACK_OPENAI_COMPATIBLE_CHAT_MODEL:
        process.env.LLM_FALLBACK_OPENAI_COMPATIBLE_CHAT_MODEL,
    };
    process.env.LLM_PRIMARY_MODEL_ALIAS = 'chat-default';
    process.env.LLM_OPENAI_COMPATIBLE_BASE_URL = 'https://provider.test';
    process.env.LLM_OPENAI_COMPATIBLE_API_KEY = 'secret-key';
    process.env.LLM_OPENAI_COMPATIBLE_CHAT_MODEL = 'real-chat-model';
    process.env.LLM_FALLBACK_MODEL_ALIAS = 'chat-fallback';
    process.env.LLM_FALLBACK_OPENAI_COMPATIBLE_BASE_URL =
      'https://fallback-provider.test';
    process.env.LLM_FALLBACK_OPENAI_COMPATIBLE_API_KEY = 'fallback-secret-key';
    process.env.LLM_FALLBACK_OPENAI_COMPATIBLE_CHAT_MODEL =
      'real-fallback-chat-model';
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

    const response = await provider.chat([{ role: 'user', content: 'Hello' }], {
      signal,
    });

    expect(provider.providerId).toBe(LlmProvider.OpenAICompatible);
    expect(provider.providerRole).toBe('primary');
    expect(provider.modelId).toBe('chat-default');
    expect(provider.isExternal).toBe(true);
    expect(response.content).toBe('Provider response');
    expect(response.usage.tokensIn).toBe(7);
    expect(response.usage.tokensOut).toBe(3);
    expect(response.usage.latencyMs).toEqual(expect.any(Number));
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://provider.test/v1/chat/completions',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer secret-key',
        }),
        body: JSON.stringify({
          model: 'real-chat-model',
          messages: [{ role: 'user', content: 'Hello' }],
        }),
        signal,
      }),
    );
  });

  it('fails safely when config is missing', async () => {
    delete process.env.LLM_OPENAI_COMPATIBLE_API_KEY;

    await expect(
      provider.chat([{ role: 'user', content: 'Hello' }]),
    ).rejects.toMatchObject({
      code: 'AI_PROVIDER_CONFIG_INVALID',
      message: 'provider_config_invalid',
      fallbackEligible: false,
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('uses separate fallback OpenAI-compatible config and safe model alias', async () => {
    process.env.LLM_FALLBACK_OPENAI_COMPATIBLE_BASE_URL =
      'https://fallback-provider.test/';
    fetchSpy.mockResolvedValueOnce(
      okResponse({
        choices: [{ message: { content: 'Fallback provider response' } }],
        usage: { prompt_tokens: 11, completion_tokens: 5 },
      }),
    );
    provider = new OpenAICompatibleChatProviderAdapter('fallback');

    const response = await provider.chat([{ role: 'user', content: 'Hello' }]);

    expect(provider.providerRole).toBe('fallback');
    expect(provider.modelId).toBe('chat-fallback');
    expect(response.content).toBe('Fallback provider response');
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://fallback-provider.test/v1/chat/completions',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer fallback-secret-key',
        }),
        body: JSON.stringify({
          model: 'real-fallback-chat-model',
          messages: [{ role: 'user', content: 'Hello' }],
        }),
      }),
    );
  });

  it.each([500, 429])(
    'throws safe transient HTTP %s errors',
    async (status) => {
      fetchSpy.mockResolvedValueOnce(errorResponse(status));

      let caught: unknown;
      try {
        await provider.chat([{ role: 'user', content: 'Hello' }]);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(AiError);
      expect(String(caught)).not.toContain('raw provider body');
    },
  );

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

  it('streams OpenAI-compatible deltas as content chunks and closes on [DONE]', async () => {
    fetchSpy.mockResolvedValueOnce(
      sseResponse([
        'data: {"choices":[{"delta":{"content":"Пр"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"ивет"}}]}\n\n',
        'data: {"usage":{"prompt_tokens":4,"completion_tokens":2}}\n\n',
        'data: [DONE]\n\n',
      ]),
    );

    const events: unknown[] = [];
    for await (const event of provider.streamChat([
      { role: 'user', content: 'Hi' },
    ])) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: 'delta', content: 'Пр' },
      { type: 'delta', content: 'ивет' },
      expect.objectContaining({
        type: 'done',
        usage: expect.objectContaining({ tokensIn: 4, tokensOut: 2 }),
      }),
    ]);
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://provider.test/v1/chat/completions',
      expect.objectContaining({
        body: JSON.stringify({
          model: 'real-chat-model',
          messages: [{ role: 'user', content: 'Hi' }],
          stream: true,
          stream_options: { include_usage: true },
        }),
      }),
    );
  });

  it('streamChat throws provider unavailable when upstream returns no content', async () => {
    fetchSpy.mockResolvedValueOnce(sseResponse(['data: [DONE]\n\n']));

    let caught: unknown;
    try {
      for await (const _ of provider.streamChat([
        { role: 'user', content: 'Hi' },
      ])) {
        // consume
      }
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(AiError);
    expect((caught as AiError).code).toBe('AI_PROVIDER_UNAVAILABLE');
  });

  it('streamChat surfaces safe HTTP errors from the upstream', async () => {
    fetchSpy.mockResolvedValueOnce(errorResponse(429));

    let caught: unknown;
    try {
      for await (const _ of provider.streamChat([
        { role: 'user', content: 'Hi' },
      ])) {
        // consume
      }
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(AiError);
    expect((caught as AiError).code).toBe('AI_PROVIDER_RATE_LIMITED');
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

  function sseResponse(frames: string[]): Response {
    const encoder = new TextEncoder();
    const chunks = frames.map((frame) => encoder.encode(frame));
    let cursor = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (cursor >= chunks.length) {
          controller.close();
          return;
        }
        controller.enqueue(chunks[cursor]);
        cursor += 1;
      },
    });
    return {
      ok: true,
      body: stream,
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
