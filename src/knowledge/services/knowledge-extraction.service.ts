import { BadRequestException, Injectable } from '@nestjs/common';
import { extname } from 'path';
import ExcelJS from 'exceljs';
import mammoth from 'mammoth';
import { PDFParse } from 'pdf-parse';
import { KnowledgeOcrService } from './knowledge-ocr.service';

export type KnowledgeExtractedTextBlock = {
  text: string;
  metadata?: Record<string, unknown>;
};

export type KnowledgeExtractionResult = {
  blocks: KnowledgeExtractedTextBlock[];
};

const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const XLSX_MIME =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const PPTX_MIME =
  'application/vnd.openxmlformats-officedocument.presentationml.presentation';
const JSON_MIME = 'application/json';
const PDF_MIME = 'application/pdf';
const TEXT_MIME = 'text/plain';
const CSV_MIME = 'text/csv';
const PNG_MIME = 'image/png';
const JPEG_MIME = 'image/jpeg';

@Injectable()
export class KnowledgeExtractionService {
  constructor(private readonly ocrService: KnowledgeOcrService) {}

  async extract(file: Express.Multer.File): Promise<KnowledgeExtractionResult> {
    const extension = extname(file.originalname).toLowerCase();
    const blocks = await this.extractBlocks(file, extension);
    const normalizedBlocks = blocks
      .map((block) => ({
        text: this.normalizeText(block.text),
        metadata: block.metadata ?? {},
      }))
      .filter((block) => block.text.length > 0);

    if (!normalizedBlocks.length) {
      throw new BadRequestException('Knowledge document text is empty');
    }

    return { blocks: normalizedBlocks };
  }

  private async extractBlocks(
    file: Express.Multer.File,
    extension: string,
  ): Promise<KnowledgeExtractedTextBlock[]> {
    if (this.isPlainText(file.mimetype, extension)) {
      return [{ text: file.buffer.toString('utf8') }];
    }

    if (file.mimetype === JSON_MIME || extension === '.json') {
      return [{ text: this.extractJson(file.buffer) }];
    }

    if (file.mimetype === PDF_MIME || extension === '.pdf') {
      return this.extractPdfBlocks(file.buffer);
    }

    if (file.mimetype === DOCX_MIME || extension === '.docx') {
      return [{ text: await this.extractDocx(file.buffer) }];
    }

    if (file.mimetype === XLSX_MIME || extension === '.xlsx') {
      return this.extractXlsx(file.buffer);
    }

    if (file.mimetype === PPTX_MIME || extension === '.pptx') {
      throw new BadRequestException(
        'PPTX extraction is not supported in this release',
      );
    }

    if (this.isOcrImage(file.mimetype, extension)) {
      const result = await this.ocrService.recognizeImage(file.buffer, {
        extension,
        mimeType: file.mimetype,
      });
      return result.blocks;
    }

    throw new BadRequestException('Unsupported knowledge document type');
  }

  private isPlainText(mimeType: string, extension: string): boolean {
    return (
      mimeType === TEXT_MIME ||
      mimeType === CSV_MIME ||
      mimeType === 'text/markdown' ||
      extension === '.txt' ||
      extension === '.csv' ||
      extension === '.md' ||
      extension === '.markdown'
    );
  }

  private extractJson(buffer: Buffer): string {
    try {
      return JSON.stringify(JSON.parse(buffer.toString('utf8')), null, 2);
    } catch {
      throw new BadRequestException('Invalid JSON knowledge document');
    }
  }

  private async extractPdf(buffer: Buffer): Promise<string> {
    const parser = new PDFParse({ data: buffer });
    try {
      const result = await parser.getText();
      return typeof result.text === 'string' ? result.text : '';
    } finally {
      await parser.destroy();
    }
  }

  private async extractPdfBlocks(
    buffer: Buffer,
  ): Promise<KnowledgeExtractedTextBlock[]> {
    const text = await this.extractPdf(buffer);
    if (this.ocrService.shouldFallbackToOcr(text)) {
      const result = await this.ocrService.recognizePdf(buffer);
      return result.blocks;
    }

    return [{ text }];
  }

  private async extractDocx(buffer: Buffer): Promise<string> {
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  }

  private async extractXlsx(
    buffer: Buffer,
  ): Promise<KnowledgeExtractedTextBlock[]> {
    const workbook = new ExcelJS.Workbook();
    const workbookBuffer = buffer.buffer.slice(
      buffer.byteOffset,
      buffer.byteOffset + buffer.byteLength,
    ) as Parameters<typeof workbook.xlsx.load>[0];
    await workbook.xlsx.load(workbookBuffer);
    const blocks: KnowledgeExtractedTextBlock[] = [];

    workbook.eachSheet((worksheet) => {
      const rows: string[] = [];
      worksheet.eachRow((row) => {
        const values = row.values;
        if (!Array.isArray(values)) {
          return;
        }

        rows.push(
          values
            .slice(1)
            .map((value) => this.stringifyCell(value))
            .join(','),
        );
      });

      if (rows.length > 0) {
        blocks.push({
          text: rows.join('\n'),
          metadata: {
            sheetName: worksheet.name,
            rowStart: 1,
            rowEnd: rows.length,
          },
        });
      }
    });

    return blocks;
  }

  private stringifyCell(value: unknown): string {
    if (value === null || value === undefined) {
      return '';
    }

    if (value instanceof Date) {
      return value.toISOString();
    }

    if (typeof value === 'object') {
      const richText = (value as { richText?: Array<{ text?: string }> }).richText;
      if (Array.isArray(richText)) {
        return richText.map((entry) => entry.text ?? '').join('');
      }

      const text = (value as { text?: unknown }).text;
      if (typeof text === 'string') {
        return text;
      }

      const result = (value as { result?: unknown }).result;
      if (result !== undefined) {
        return this.stringifyCell(result);
      }
    }

    return String(value);
  }

  private normalizeText(text: string): string {
    return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  }

  private isOcrImage(mimeType: string, extension: string): boolean {
    return (
      (mimeType === PNG_MIME && extension === '.png') ||
      (mimeType === JPEG_MIME && ['.jpg', '.jpeg'].includes(extension))
    );
  }
}
