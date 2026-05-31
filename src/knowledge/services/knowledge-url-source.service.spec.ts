import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { KnowledgeHtmlExtractionService } from './knowledge-html-extraction.service';
import { KnowledgeUrlSourceService } from './knowledge-url-source.service';

describe('KnowledgeUrlSourceService', () => {
  let originalEnv: Record<string, string | undefined>;
  let extractor: { extract: jest.Mock };
  let resolveHost: jest.Mock;
  let fetcher: jest.Mock;
  let service: KnowledgeUrlSourceService;

  beforeEach(() => {
    originalEnv = {
      KNOWLEDGE_URL_MAX_REDIRECTS: process.env.KNOWLEDGE_URL_MAX_REDIRECTS,
      KNOWLEDGE_URL_TIMEOUT_MS: process.env.KNOWLEDGE_URL_TIMEOUT_MS,
      KNOWLEDGE_URL_MAX_RESPONSE_SIZE_BYTES:
        process.env.KNOWLEDGE_URL_MAX_RESPONSE_SIZE_BYTES,
    };
    process.env.KNOWLEDGE_URL_MAX_REDIRECTS = '2';
    process.env.KNOWLEDGE_URL_TIMEOUT_MS = '1000';
    process.env.KNOWLEDGE_URL_MAX_RESPONSE_SIZE_BYTES = '1000';
    extractor = {
      extract: jest.fn().mockReturnValue({
        title: 'Fetched title',
        blocks: [{ text: 'Useful fetched page content for indexing.' }],
      }),
    };
    resolveHost = jest.fn().mockResolvedValue(['93.184.216.34']);
    fetcher = jest.fn().mockResolvedValue(htmlResponse('<main>Useful content</main>'));
    service = new KnowledgeUrlSourceService(extractor as never);
    jest.spyOn(service as never, 'resolveHost').mockImplementation(resolveHost);
    jest.spyOn(service as never, 'fetchUrl').mockImplementation(fetcher);
  });

  afterEach(() => {
    restoreEnv(originalEnv);
    jest.restoreAllMocks();
  });

  it('fetches public HTML and returns extracted text blocks', async () => {
    const result = await service.acquire('https://example.com/page#section');

    expect(result.sourceUrl).toBe('https://example.com/page');
    expect(result.title).toBe('Fetched title');
    expect(result.mimeType).toBe('text/html');
    expect(result.blocks[0].text).toContain('Useful fetched page content');
    expect(resolveHost).toHaveBeenCalledWith('example.com');
    expect(fetcher).toHaveBeenCalledWith(
      'https://example.com/page',
      expect.objectContaining({ redirect: 'manual' }),
    );
  });

  it('resolves through Nest DI without unresolved function dependencies', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        KnowledgeHtmlExtractionService,
        KnowledgeUrlSourceService,
      ],
    }).compile();

    expect(moduleRef.get(KnowledgeUrlSourceService)).toBeInstanceOf(
      KnowledgeUrlSourceService,
    );
  });

  it.each([
    ['non-http protocol', 'ftp://example.com/file'],
    ['credentials', 'https://user:pass@example.com/page'],
    ['localhost hostname', 'https://localhost/page'],
    ['IPv4 loopback', 'http://127.0.0.1/page'],
    ['IPv6 loopback', 'http://[::1]/page'],
    ['private IPv4', 'http://192.168.1.10/page'],
    ['metadata IP', 'http://169.254.169.254/latest'],
    ['IPv4-mapped loopback hex', 'http://[::ffff:7f00:1]/page'],
    ['IPv4-mapped private hex', 'http://[::ffff:0a00:1]/page'],
    ['IPv4-mapped metadata hex', 'http://[::ffff:a9fe:a9fe]/page'],
    ['NAT64 loopback hex', 'http://[64:ff9b::7f00:1]/page'],
    ['NAT64 private hex', 'http://[64:ff9b::0a00:1]/page'],
    ['NAT64 metadata hex', 'http://[64:ff9b::a9fe:a9fe]/page'],
    ['IPv6 documentation', 'http://[2001:db8::1]/page'],
    ['IPv6 discard-only', 'http://[100::1]/page'],
  ])('rejects %s before fetching', async (_label, url) => {
    await expect(service.acquire(url)).rejects.toThrow(BadRequestException);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('rejects hostnames that resolve to private IPs', async () => {
    resolveHost.mockResolvedValueOnce(['10.0.0.5']);

    await expect(service.acquire('https://example.com/page')).rejects.toThrow(
      BadRequestException,
    );
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('revalidates redirect targets and rejects private redirects', async () => {
    fetcher.mockResolvedValueOnce(redirectResponse('http://127.0.0.1/admin'));

    await expect(service.acquire('https://example.com/page')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('rejects too many redirects', async () => {
    process.env.KNOWLEDGE_URL_MAX_REDIRECTS = '1';
    fetcher
      .mockResolvedValueOnce(redirectResponse('https://example.com/next'))
      .mockResolvedValueOnce(redirectResponse('https://example.com/final'));

    await expect(service.acquire('https://example.com/page')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('handles timeout safely', async () => {
    fetcher.mockRejectedValueOnce(
      Object.assign(new Error('operation timed out with raw url'), {
        name: 'AbortError',
      }),
    );

    await expect(service.acquire('https://example.com/page')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('rejects oversized responses', async () => {
    process.env.KNOWLEDGE_URL_MAX_RESPONSE_SIZE_BYTES = '10';
    fetcher.mockResolvedValueOnce(htmlResponse('This response is too large'));

    await expect(service.acquire('https://example.com/page')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('rejects non-HTML content types', async () => {
    fetcher.mockResolvedValueOnce(
      new Response('{"ok":true}', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    await expect(service.acquire('https://example.com/page')).rejects.toThrow(
      BadRequestException,
    );
  });

  function htmlResponse(body: string): Response {
    return new Response(body, {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    });
  }

  function redirectResponse(location: string): Response {
    return new Response('', {
      status: 302,
      headers: { location },
    });
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
