import { BadRequestException } from '@nestjs/common';
import { KnowledgeChunkingService } from './knowledge-chunking.service';

describe('KnowledgeChunkingService', () => {
  let service: KnowledgeChunkingService;
  let originalEnv: Record<string, string | undefined>;

  beforeEach(() => {
    originalEnv = {
      KNOWLEDGE_CHUNK_SIZE_CHARS: process.env.KNOWLEDGE_CHUNK_SIZE_CHARS,
      KNOWLEDGE_CHUNK_OVERLAP_CHARS: process.env.KNOWLEDGE_CHUNK_OVERLAP_CHARS,
      KNOWLEDGE_MAX_CHUNKS_PER_DOCUMENT:
        process.env.KNOWLEDGE_MAX_CHUNKS_PER_DOCUMENT,
    };
    process.env.KNOWLEDGE_CHUNK_SIZE_CHARS = '20';
    process.env.KNOWLEDGE_CHUNK_OVERLAP_CHARS = '5';
    process.env.KNOWLEDGE_MAX_CHUNKS_PER_DOCUMENT = '10';
    service = new KnowledgeChunkingService();
  });

  afterEach(() => restoreEnv(originalEnv));

  it('creates stable paragraph-aware chunks with overlap and metadata', () => {
    const chunks = service.chunk([
      {
        text: 'Alpha beta gamma.\n\nDelta epsilon zeta eta theta iota.',
        metadata: { pageNumber: 1 },
      },
    ]);

    expect(chunks.map((chunk) => chunk.chunkIndex)).toEqual([0, 1, 2]);
    expect(chunks[0].text).toBe('Alpha beta gamma.');
    expect(chunks[1].text).toContain('Delta');
    expect(chunks[1].metadata).toEqual({ pageNumber: 1 });
    expect(chunks[1].charLength).toBe(chunks[1].text.length);
    expect(chunks[1].tokenEstimate).toBeGreaterThan(0);
    expect(chunks[2].text).toContain('theta');
    expect(chunks[1].text.slice(-5)).toBe(chunks[2].text.slice(0, 5));
  });

  it('fails closed when chunk count exceeds the configured limit', () => {
    process.env.KNOWLEDGE_MAX_CHUNKS_PER_DOCUMENT = '1';

    expect(() =>
      service.chunk([{ text: 'one two three four five six seven eight nine ten' }]),
    ).toThrow(BadRequestException);
  });

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
