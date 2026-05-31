import { execFile } from 'child_process';
import { mkdtemp, readdir, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';

export type KnowledgeRenderedPdfPage = {
  path: string;
  pageNumber: number;
};

export type KnowledgeRenderedPdfPages = {
  tempDir: string;
  pages: KnowledgeRenderedPdfPage[];
};

@Injectable()
export class KnowledgePdfPageRendererService {
  async render(buffer: Buffer): Promise<KnowledgeRenderedPdfPages> {
    const tempDir = await mkdtemp(join(this.getTempBaseDir(), 'knowledge-pdf-ocr-'));
    try {
      const inputPath = join(tempDir, 'input.pdf');
      const outputPrefix = join(tempDir, 'page');
      await writeFile(inputPath, buffer);
      await this.executePdftoppm(inputPath, outputPrefix);
      const pages = await this.listRenderedPages(tempDir);

      if (!pages.length) {
        throw new BadRequestException('Knowledge PDF OCR rendering failed');
      }

      return { tempDir, pages };
    } catch (error) {
      await this.cleanupSafely(tempDir);
      throw error;
    }
  }

  async cleanup(tempDir: string): Promise<void> {
    await rm(tempDir, { recursive: true, force: true });
  }

  private executePdftoppm(inputPath: string, outputPrefix: string): Promise<void> {
    return new Promise((resolve, reject) => {
      execFile(
        'pdftoppm',
        [
          '-r',
          '200',
          '-png',
          '-f',
          '1',
          '-l',
          String(this.getMaxPages()),
          inputPath,
          outputPrefix,
        ],
        { timeout: this.getTimeoutMs(), maxBuffer: 1024 * 1024 },
        (error) => {
          if (!error) {
            resolve();
            return;
          }

          const execError = error as NodeJS.ErrnoException & {
            killed?: boolean;
            signal?: NodeJS.Signals;
          };
          if (execError.code === 'ENOENT') {
            reject(new ServiceUnavailableException('Knowledge PDF renderer unavailable'));
            return;
          }
          if (execError.killed || execError.signal === 'SIGTERM') {
            reject(new BadRequestException('Knowledge PDF OCR rendering timed out'));
            return;
          }

          reject(new BadRequestException('Knowledge PDF OCR rendering failed'));
        },
      );
    });
  }

  private async listRenderedPages(tempDir: string): Promise<KnowledgeRenderedPdfPage[]> {
    const entries = await readdir(tempDir);
    return entries
      .map((entry) => {
        const match = /^page-(\d+)\.png$/.exec(entry);
        if (!match) {
          return null;
        }

        return {
          path: join(tempDir, entry),
          pageNumber: Number(match[1]),
        };
      })
      .filter((page): page is KnowledgeRenderedPdfPage => page !== null)
      .sort((left, right) => left.pageNumber - right.pageNumber);
  }

  private getMaxPages(): number {
    const parsed = Number(process.env.KNOWLEDGE_OCR_MAX_PAGES);
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 10;
  }

  private getTimeoutMs(): number {
    const parsed = Number(process.env.KNOWLEDGE_OCR_TIMEOUT_MS);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 30000;
  }

  private getTempBaseDir(): string {
    return process.env.KNOWLEDGE_OCR_TEMP_DIR || tmpdir();
  }

  private async cleanupSafely(tempDir: string): Promise<void> {
    try {
      await this.cleanup(tempDir);
    } catch {
      // Cleanup failures should not hide PDF rendering outcomes.
    }
  }
}
