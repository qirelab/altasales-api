import { BadRequestException, Injectable } from '@nestjs/common';
import type {
  KnowledgeExtractedTextBlock,
  KnowledgeExtractionResult,
} from './knowledge-extraction.service';
import { KnowledgePdfPageRendererService } from './knowledge-pdf-page-renderer.service';
import { KnowledgeTesseractCliOcrProvider } from './knowledge-tesseract-cli-ocr-provider.service';

const ENABLED_PROVIDER = 'tesseract_cli';

@Injectable()
export class KnowledgeOcrService {
  constructor(
    private readonly tesseractProvider: KnowledgeTesseractCliOcrProvider,
    private readonly pdfPageRenderer: KnowledgePdfPageRendererService,
  ) {}

  shouldFallbackToOcr(text: string): boolean {
    return this.normalizeText(text).length < this.getMinTextLength();
  }

  async recognizeImage(
    buffer: Buffer,
    options: { extension: string; mimeType: string },
  ): Promise<KnowledgeExtractionResult> {
    this.assertEnabled();
    const text = await this.tesseractProvider.recognizeImageBuffer(buffer, {
      extension: options.extension,
    });
    const normalizedText = this.normalizeText(text);
    if (!normalizedText) {
      throw new BadRequestException('Knowledge OCR text is empty');
    }
    this.assertMinTextLength(normalizedText);

    return {
      blocks: [
        {
          text: normalizedText,
          metadata: {
            sourceFormat: 'ocr',
            mimeType: options.mimeType,
          },
        },
      ],
    };
  }

  async recognizePdf(buffer: Buffer): Promise<KnowledgeExtractionResult> {
    this.assertEnabled();
    const rendered = await this.pdfPageRenderer.render(buffer);
    try {
      const blocks: KnowledgeExtractedTextBlock[] = [];
      for (const page of rendered.pages) {
        const text = await this.tesseractProvider.recognizeImageFile(page.path);
        const normalizedText = this.normalizeText(text);
        if (!normalizedText) {
          continue;
        }

        blocks.push({
          text: normalizedText,
          metadata: {
            sourceFormat: 'ocr',
            pageNumber: page.pageNumber,
          },
        });
      }

      if (!blocks.length) {
        throw new BadRequestException('Knowledge OCR text is empty');
      }
      this.assertMinTextLength(blocks.map((block) => block.text).join('\n'));

      return { blocks };
    } finally {
      await this.cleanupRenderedPdf(rendered.tempDir);
    }
  }

  private assertEnabled(): void {
    const provider = process.env.KNOWLEDGE_OCR_PROVIDER || 'disabled';
    if (provider === 'disabled') {
      throw new BadRequestException('Knowledge OCR is disabled');
    }
    if (provider !== ENABLED_PROVIDER) {
      throw new BadRequestException('Knowledge OCR provider is not available');
    }
  }

  private getMinTextLength(): number {
    const parsed = Number(process.env.KNOWLEDGE_OCR_MIN_TEXT_LENGTH);
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 50;
  }

  private assertMinTextLength(text: string): void {
    if (this.normalizeText(text).length < this.getMinTextLength()) {
      throw new BadRequestException('Knowledge OCR text is too short');
    }
  }

  private normalizeText(text: string): string {
    return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  }

  private async cleanupRenderedPdf(tempDir: string): Promise<void> {
    try {
      await this.pdfPageRenderer.cleanup(tempDir);
    } catch {
      // Cleanup failures should not hide OCR outcomes.
    }
  }
}
