import { execFile } from 'child_process';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';

type ExecFileResult = {
  stdout: string;
};

@Injectable()
export class KnowledgeTesseractCliOcrProvider {
  async recognizeImageBuffer(
    buffer: Buffer,
    options: { extension: string },
  ): Promise<string> {
    const tempDir = await mkdtemp(join(this.getTempBaseDir(), 'knowledge-ocr-'));
    try {
      const inputPath = join(tempDir, `input${this.normalizeExtension(options.extension)}`);
      await writeFile(inputPath, buffer);
      return await this.recognizeImageFile(inputPath);
    } finally {
      await this.cleanupTempDir(tempDir);
    }
  }

  async recognizeImageFile(filePath: string): Promise<string> {
    const result = await this.executeTesseract(filePath);
    return result.stdout;
  }

  private executeTesseract(filePath: string): Promise<ExecFileResult> {
    return new Promise((resolve, reject) => {
      execFile(
        'tesseract',
        [filePath, 'stdout', '-l', this.getLanguages()],
        {
          timeout: this.getTimeoutMs(),
          maxBuffer: 10 * 1024 * 1024,
          env: {
            ...process.env,
            OMP_THREAD_LIMIT: process.env.OMP_THREAD_LIMIT || '1',
          },
        },
        (error, stdout) => {
          if (!error) {
            resolve({ stdout });
            return;
          }

          const execError = error as NodeJS.ErrnoException & {
            killed?: boolean;
            signal?: NodeJS.Signals;
          };
          if (execError.code === 'ENOENT') {
            reject(new ServiceUnavailableException('Knowledge OCR provider unavailable'));
            return;
          }
          if (execError.killed || execError.signal === 'SIGTERM') {
            reject(new BadRequestException('Knowledge OCR timed out'));
            return;
          }

          reject(new BadRequestException('Knowledge OCR failed'));
        },
      );
    });
  }

  private normalizeExtension(extension: string): string {
    const normalized = extension.toLowerCase();
    return ['.png', '.jpg', '.jpeg'].includes(normalized) ? normalized : '.png';
  }

  private getLanguages(): string {
    return process.env.KNOWLEDGE_OCR_LANGUAGES || 'rus+eng';
  }

  private getTimeoutMs(): number {
    const parsed = Number(process.env.KNOWLEDGE_OCR_TIMEOUT_MS);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 30000;
  }

  private getTempBaseDir(): string {
    return process.env.KNOWLEDGE_OCR_TEMP_DIR || tmpdir();
  }

  private async cleanupTempDir(tempDir: string): Promise<void> {
    try {
      await rm(tempDir, { recursive: true, force: true });
    } catch {
      // Cleanup failures should not hide OCR outcomes.
    }
  }
}
