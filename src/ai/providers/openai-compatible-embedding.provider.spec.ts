import { OpenAICompatibleEmbeddingProviderAdapter } from './openai-compatible-embedding.provider';

describe('OpenAICompatibleEmbeddingProviderAdapter', () => {
  let provider: OpenAICompatibleEmbeddingProviderAdapter;
  let fetchSpy: jest.SpyInstance;
  let originalEnv: Record<string, string | undefined>;

  beforeEach(() => {
    originalEnv = {
      LLM_EMBEDDING_MODEL_ALIAS: process.env.LLM_EMBEDDING_MODEL_ALIAS,
      LLM_OPENAI_COMPATIBLE_BASE_URL:
        process.env.LLM_OPENAI_COMPATIBLE_BASE_URL,
      LLM_OPENAI_COMPATIBLE_API_KEY: process.env.LLM_OPENAI_COMPATIBLE_API_KEY,
      LLM_OPENAI_COMPATIBLE_EMBEDDING_MODEL:
        process.env.LLM_OPENAI_COMPATIBLE_EMBEDDING_MODEL,
      LLM_OPENAI_COMPATIBLE_EMBEDDING_DIMENSIONS:
        process.env.LLM_OPENAI_COMPATIBLE_EMBEDDING_DIMENSIONS,
    };
    process.env.LLM_EMBEDDING_MODEL_ALIAS = 'embedding-default';
    process.env.LLM_OPENAI_COMPATIBLE_BASE_URL = 'https://provider.test';
    process.env.LLM_OPENAI_COMPATIBLE_API_KEY = 'secret-key';
    process.env.LLM_OPENAI_COMPATIBLE_EMBEDDING_MODEL = 'real-embedding-model';
    process.env.LLM_OPENAI_COMPATIBLE_EMBEDDING_DIMENSIONS = '2';
    provider = new OpenAICompatibleEmbeddingProviderAdapter();
    fetchSpy = jest.spyOn(global, 'fetch');
  });

  afterEach(() => {
    restoreEnv(originalEnv);
    jest.restoreAllMocks();
  });

  it('calls OpenAI-compatible embeddings for multiple inputs', async () => {
    const signal = new AbortController().signal;
    fetchSpy.mockResolvedValueOnce(
      okResponse({
        data: [
          { index: 0, embedding: [0.1, 0.2] },
          { index: 1, embedding: [0.3, 0.4] },
        ],
        usage: { prompt_tokens: 6, total_tokens: 6 },
      }),
    );

    const response = await provider.embed(['first', 'second'], { signal });

    expect(response.vectors).toEqual([
      [0.1, 0.2],
      [0.3, 0.4],
    ]);
    expect(response.usage.tokensIn).toBe(6);
    expect(response.dimensions).toBe(2);
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://provider.test/v1/embeddings',
      expect.objectContaining({ signal }),
    );
  });

  it('fails safely when config is missing', async () => {
    delete process.env.LLM_OPENAI_COMPATIBLE_BASE_URL;

    await expect(provider.embed(['private chunk'])).rejects.toMatchObject({
      code: 'AI_EMBEDDING_PROVIDER_UNAVAILABLE',
      message: 'embedding_provider_unavailable',
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('fails closed on output count mismatch', async () => {
    fetchSpy.mockResolvedValueOnce(
      okResponse({ data: [{ index: 0, embedding: [0.1, 0.2] }] }),
    );

    await expect(provider.embed(['first', 'second'])).rejects.toMatchObject({
      code: 'AI_EMBEDDING_RESPONSE_INVALID',
    });
  });

  it('validates configured vector dimensions', async () => {
    fetchSpy.mockResolvedValueOnce(
      okResponse({ data: [{ index: 0, embedding: [0.1, 0.2, 0.3] }] }),
    );

    await expect(provider.embed(['first'])).rejects.toMatchObject({
      code: 'AI_EMBEDDING_RESPONSE_INVALID',
    });
  });

  it('does not leak input text, vectors, baseUrl, apiKey, real model, or raw body', async () => {
    fetchSpy.mockResolvedValueOnce(errorResponse(500));

    await expect(provider.embed(['private chunk'])).rejects.not.toThrow(
      'private chunk [0.1,0.2] https://provider.test secret-key real-embedding-model raw provider body',
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
      text: jest.fn().mockResolvedValue('raw provider body private chunk'),
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
