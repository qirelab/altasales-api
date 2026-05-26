import { BadRequestException } from '@nestjs/common';
import { KnowledgeExtractionService } from './knowledge-extraction.service';

describe('KnowledgeExtractionService', () => {
  let service: KnowledgeExtractionService;

  beforeEach(() => {
    service = new KnowledgeExtractionService();
  });

  it('extracts plain text without storing unsafe metadata', async () => {
    const result = await service.extract(
      file('guide.txt', 'text/plain', 'Hello knowledge base'),
    );

    expect(result.blocks).toEqual([
      {
        text: 'Hello knowledge base',
        metadata: {},
      },
    ]);
  });

  it('extracts json as safe pretty text', async () => {
    const result = await service.extract(
      file('payload.json', 'application/json', '{"a":1,"b":{"c":2}}'),
    );

    expect(result.blocks[0].text).toContain('"a": 1');
    expect(result.blocks[0].text).toContain('"c": 2');
  });

  it('extracts csv-like files as text', async () => {
    const result = await service.extract(
      file('table.csv', 'text/csv', 'name,value\nalpha,1'),
    );

    expect(result.blocks[0].text).toContain('name,value');
  });

  it('supports markdown by extension fallback', async () => {
    const result = await service.extract(
      file('readme.md', 'application/octet-stream', '# Title\nBody'),
    );

    expect(result.blocks[0].text).toContain('# Title');
  });

  it('fails closed on unsupported mime type', async () => {
    await expect(
      service.extract(file('deck.ppt', 'application/vnd.ms-powerpoint', 'legacy')),
    ).rejects.toThrow(BadRequestException);
  });

  it('fails closed on empty extracted text', async () => {
    await expect(
      service.extract(file('empty.txt', 'text/plain', '   ')),
    ).rejects.toThrow(BadRequestException);
  });

  function file(
    originalname: string,
    mimetype: string,
    content: string,
  ): Express.Multer.File {
    const buffer = Buffer.from(content, 'utf8');
    return {
      originalname,
      mimetype,
      size: buffer.length,
      buffer,
    } as Express.Multer.File;
  }
});
