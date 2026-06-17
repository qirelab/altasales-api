import { BadRequestException } from '@nestjs/common';
import { KnowledgeExtractionService } from './knowledge-extraction.service';

describe('KnowledgeExtractionService', () => {
  let service: KnowledgeExtractionService;
  let ocrService: {
    recognizeImage: jest.Mock;
    recognizePdf: jest.Mock;
    shouldFallbackToOcr: jest.Mock;
  };

  beforeEach(() => {
    ocrService = {
      recognizeImage: jest.fn(),
      recognizePdf: jest.fn(),
      shouldFallbackToOcr: jest.fn().mockReturnValue(false),
    };
    service = new KnowledgeExtractionService(ocrService as never);
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

  it('routes PNG images through OCR extraction', async () => {
    ocrService.recognizeImage.mockResolvedValueOnce({
      blocks: [{ text: 'OCR extracted scan text', metadata: { sourceFormat: 'ocr' } }],
    });

    const result = await service.extract(
      file('scan.png', 'image/png', 'fake-image-bytes'),
    );

    expect(ocrService.recognizeImage).toHaveBeenCalledWith(
      expect.any(Buffer),
      { extension: '.png', mimeType: 'image/png' },
    );
    expect(result.blocks[0].text).toBe('OCR extracted scan text');
  });

  it('fails safely when OCR is disabled for images', async () => {
    ocrService.recognizeImage.mockRejectedValueOnce(
      new BadRequestException('Knowledge OCR is disabled'),
    );

    await expect(
      service.extract(file('scan.jpg', 'image/jpeg', 'fake-image-bytes')),
    ).rejects.toThrow('Knowledge OCR is disabled');
  });

  it('uses embedded PDF text when it is long enough', async () => {
    jest
      .spyOn(service as unknown as { extractPdf: () => Promise<string> }, 'extractPdf')
      .mockResolvedValueOnce('Long enough embedded text from a searchable PDF document.');
    ocrService.shouldFallbackToOcr.mockReturnValueOnce(false);

    const result = await service.extract(
      file('guide.pdf', 'application/pdf', 'fake-pdf'),
    );

    expect(ocrService.recognizePdf).not.toHaveBeenCalled();
    expect(result.blocks[0].text).toContain('Long enough embedded text');
  });

  it('falls back to OCR when PDF embedded text is too short', async () => {
    jest
      .spyOn(service as unknown as { extractPdf: () => Promise<string> }, 'extractPdf')
      .mockResolvedValueOnce(' ');
    ocrService.shouldFallbackToOcr.mockReturnValueOnce(true);
    ocrService.recognizePdf.mockResolvedValueOnce({
      blocks: [{ text: 'OCR text from rendered PDF page', metadata: { pageNumber: 1 } }],
    });

    const result = await service.extract(
      file('scan.pdf', 'application/pdf', 'fake-pdf'),
    );

    expect(ocrService.recognizePdf).toHaveBeenCalledWith(expect.any(Buffer));
    expect(result.blocks[0]).toEqual({
      text: 'OCR text from rendered PDF page',
      metadata: { pageNumber: 1 },
    });
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
