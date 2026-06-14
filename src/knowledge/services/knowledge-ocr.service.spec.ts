import { BadRequestException } from '@nestjs/common';
import { KnowledgeOcrService } from './knowledge-ocr.service';

describe('KnowledgeOcrService', () => {
  const originalEnv = process.env;
  let tesseractProvider: {
    recognizeImageBuffer: jest.Mock;
    recognizeImageFile: jest.Mock;
  };
  let pdfPageRenderer: {
    render: jest.Mock;
    cleanup: jest.Mock;
  };
  let service: KnowledgeOcrService;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.KNOWLEDGE_OCR_PROVIDER;
    delete process.env.KNOWLEDGE_OCR_MIN_TEXT_LENGTH;
    tesseractProvider = {
      recognizeImageBuffer: jest.fn(),
      recognizeImageFile: jest.fn(),
    };
    pdfPageRenderer = {
      render: jest.fn(),
      cleanup: jest.fn(),
    };
    service = new KnowledgeOcrService(
      tesseractProvider as never,
      pdfPageRenderer as never,
    );
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('is disabled by default', async () => {
    await expect(
      service.recognizeImage(Buffer.from('image'), {
        extension: '.png',
        mimeType: 'image/png',
      }),
    ).rejects.toThrow('Knowledge OCR is disabled');
  });

  it('recognizes image OCR through the configured native provider', async () => {
    process.env.KNOWLEDGE_OCR_PROVIDER = 'tesseract_cli';
    process.env.KNOWLEDGE_OCR_MIN_TEXT_LENGTH = '10';
    tesseractProvider.recognizeImageBuffer.mockResolvedValueOnce(' OCR image text \n');

    const result = await service.recognizeImage(Buffer.from('image'), {
      extension: '.jpg',
      mimeType: 'image/jpeg',
    });

    expect(tesseractProvider.recognizeImageBuffer).toHaveBeenCalledWith(
      expect.any(Buffer),
      { extension: '.jpg' },
    );
    expect(result.blocks).toEqual([
      {
        text: 'OCR image text',
        metadata: {
          sourceFormat: 'ocr',
          mimeType: 'image/jpeg',
        },
      },
    ]);
  });

  it('uses the configured minimum text threshold for PDF OCR fallback', () => {
    process.env.KNOWLEDGE_OCR_MIN_TEXT_LENGTH = '12';

    expect(service.shouldFallbackToOcr('short')).toBe(true);
    expect(service.shouldFallbackToOcr('long enough text')).toBe(false);
  });

  it('renders PDF pages, OCRs each page, and cleans up temporary files', async () => {
    process.env.KNOWLEDGE_OCR_PROVIDER = 'tesseract_cli';
    process.env.KNOWLEDGE_OCR_MIN_TEXT_LENGTH = '10';
    pdfPageRenderer.render.mockResolvedValueOnce({
      tempDir: '/tmp/knowledge-pdf-ocr-test',
      pages: [
        { path: '/tmp/page-1.png', pageNumber: 1 },
        { path: '/tmp/page-2.png', pageNumber: 2 },
      ],
    });
    tesseractProvider.recognizeImageFile
      .mockResolvedValueOnce(' first page text ')
      .mockResolvedValueOnce('second page text');

    const result = await service.recognizePdf(Buffer.from('pdf'));

    expect(tesseractProvider.recognizeImageFile).toHaveBeenCalledTimes(2);
    expect(pdfPageRenderer.cleanup).toHaveBeenCalledWith('/tmp/knowledge-pdf-ocr-test');
    expect(result.blocks).toEqual([
      {
        text: 'first page text',
        metadata: { sourceFormat: 'ocr', pageNumber: 1 },
      },
      {
        text: 'second page text',
        metadata: { sourceFormat: 'ocr', pageNumber: 2 },
      },
    ]);
  });

  it('fails closed when OCR returns no text', async () => {
    process.env.KNOWLEDGE_OCR_PROVIDER = 'tesseract_cli';
    tesseractProvider.recognizeImageBuffer.mockResolvedValueOnce('   ');

    await expect(
      service.recognizeImage(Buffer.from('image'), {
        extension: '.png',
        mimeType: 'image/png',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('fails safely when image OCR text is too short', async () => {
    process.env.KNOWLEDGE_OCR_PROVIDER = 'tesseract_cli';
    process.env.KNOWLEDGE_OCR_MIN_TEXT_LENGTH = '10';
    tesseractProvider.recognizeImageBuffer.mockResolvedValueOnce('short');

    await expect(
      service.recognizeImage(Buffer.from('image'), {
        extension: '.png',
        mimeType: 'image/png',
      }),
    ).rejects.toThrow('Knowledge OCR text is too short');
  });

  it('fails safely when combined PDF OCR text is too short', async () => {
    process.env.KNOWLEDGE_OCR_PROVIDER = 'tesseract_cli';
    process.env.KNOWLEDGE_OCR_MIN_TEXT_LENGTH = '20';
    pdfPageRenderer.render.mockResolvedValueOnce({
      tempDir: '/tmp/knowledge-pdf-ocr-test',
      pages: [{ path: '/tmp/page-1.png', pageNumber: 1 }],
    });
    tesseractProvider.recognizeImageFile.mockResolvedValueOnce('short');

    await expect(service.recognizePdf(Buffer.from('pdf'))).rejects.toThrow(
      'Knowledge OCR text is too short',
    );
  });

  it('preserves OCR failure when PDF cleanup also fails', async () => {
    process.env.KNOWLEDGE_OCR_PROVIDER = 'tesseract_cli';
    pdfPageRenderer.render.mockResolvedValueOnce({
      tempDir: '/tmp/knowledge-pdf-ocr-test',
      pages: [{ path: '/tmp/page-1.png', pageNumber: 1 }],
    });
    tesseractProvider.recognizeImageFile.mockRejectedValueOnce(
      new BadRequestException('Knowledge OCR failed'),
    );
    pdfPageRenderer.cleanup.mockRejectedValueOnce(new Error('cleanup failed'));

    await expect(service.recognizePdf(Buffer.from('pdf'))).rejects.toThrow(
      'Knowledge OCR failed',
    );
  });

  it('returns PDF OCR output when cleanup fails after success', async () => {
    process.env.KNOWLEDGE_OCR_PROVIDER = 'tesseract_cli';
    process.env.KNOWLEDGE_OCR_MIN_TEXT_LENGTH = '10';
    pdfPageRenderer.render.mockResolvedValueOnce({
      tempDir: '/tmp/knowledge-pdf-ocr-test',
      pages: [{ path: '/tmp/page-1.png', pageNumber: 1 }],
    });
    tesseractProvider.recognizeImageFile.mockResolvedValueOnce('long enough OCR text');
    pdfPageRenderer.cleanup.mockRejectedValueOnce(new Error('cleanup failed'));

    await expect(service.recognizePdf(Buffer.from('pdf'))).resolves.toEqual({
      blocks: [
        {
          text: 'long enough OCR text',
          metadata: { sourceFormat: 'ocr', pageNumber: 1 },
        },
      ],
    });
  });
});
