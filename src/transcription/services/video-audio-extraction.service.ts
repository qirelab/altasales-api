import { execFile } from 'child_process';
import * as fsPromises from 'fs/promises';
import { tmpdir } from 'os';
import { extname, join } from 'path';
import { Injectable } from '@nestjs/common';
import {
  isTranscriptionProviderError,
  TranscriptionProviderError,
} from './transcription-provider-error';

type ExecFileError = NodeJS.ErrnoException & {
  killed?: boolean;
  signal?: NodeJS.Signals;
};

const DEFAULT_EXTRACTION_TIMEOUT_MS = 300_000;
const FFMPEG_OUTPUT_MAX_BUFFER = 1024 * 1024;

@Injectable()
export class VideoAudioExtractionService {
  async extractAudio(video: Express.Multer.File): Promise<Express.Multer.File> {
    const tempDir = await fsPromises.mkdtemp(
      join(this.getTempBaseDir(), 'transcription-video-'),
    );

    try {
      const inputPath = video.path || join(tempDir, `input${this.videoExtension(video)}`);
      const outputPath = join(tempDir, 'extracted-audio.ogg');
      if (!video.path) {
        await fsPromises.writeFile(inputPath, video.buffer);
      }
      await this.executeFfmpeg(inputPath, outputPath);
      const buffer = await fsPromises.readFile(outputPath);

      if (!buffer.length) {
        throw new TranscriptionProviderError(
          'TRANSCRIPTION_VIDEO_AUDIO_STREAM_NOT_FOUND',
          'Video audio stream not found',
        );
      }

      return {
        originalname: 'extracted-audio.ogg',
        mimetype: 'audio/ogg',
        size: buffer.length,
        buffer,
      } as Express.Multer.File;
    } catch (error) {
      if (isTranscriptionProviderError(error)) {
        throw error;
      }
      throw new TranscriptionProviderError(
        'TRANSCRIPTION_VIDEO_EXTRACTION_FAILED',
        'Video audio extraction failed',
      );
    } finally {
      await this.cleanupTempDir(tempDir);
    }
  }

  private executeFfmpeg(inputPath: string, outputPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      execFile(
        this.getFfmpegPath(),
        [
          '-y',
          '-i',
          inputPath,
          '-vn',
          '-map',
          '0:a:0',
          '-acodec',
          'libopus',
          outputPath,
        ],
        {
          timeout: this.getTimeoutMs(),
          maxBuffer: FFMPEG_OUTPUT_MAX_BUFFER,
        },
        (error, stdout, stderr) => {
          if (!error) {
            resolve();
            return;
          }

          reject(this.toSafeExtractionError(error as ExecFileError, stdout, stderr));
        },
      );
    });
  }

  private toSafeExtractionError(
    error: ExecFileError,
    stdout: string,
    stderr: string,
  ): TranscriptionProviderError {
    if (error.code === 'ENOENT') {
      return new TranscriptionProviderError(
        'TRANSCRIPTION_FFMPEG_UNAVAILABLE',
        'Video audio extraction provider unavailable',
      );
    }

    if (error.killed || error.signal === 'SIGTERM') {
      return new TranscriptionProviderError(
        'TRANSCRIPTION_VIDEO_EXTRACTION_TIMEOUT',
        'Video audio extraction timed out',
      );
    }

    if (this.isMissingAudioStream(stdout) || this.isMissingAudioStream(stderr)) {
      return new TranscriptionProviderError(
        'TRANSCRIPTION_VIDEO_AUDIO_STREAM_NOT_FOUND',
        'Video audio stream not found',
      );
    }

    return new TranscriptionProviderError(
      'TRANSCRIPTION_VIDEO_EXTRACTION_FAILED',
      'Video audio extraction failed',
    );
  }

  private isMissingAudioStream(output: string): boolean {
    return /matches no streams|audio stream not found|does not contain any stream/i.test(output);
  }

  private videoExtension(video: Express.Multer.File): string {
    const extension = extname(video.originalname).toLowerCase();
    return ['.mp4', '.webm', '.mov'].includes(extension) ? extension : '.video';
  }

  private getFfmpegPath(): string {
    return process.env.TRANSCRIPTION_FFMPEG_PATH?.trim() || 'ffmpeg';
  }

  private getTimeoutMs(): number {
    const parsed = Number(process.env.TRANSCRIPTION_VIDEO_EXTRACTION_TIMEOUT_MS);
    return Number.isFinite(parsed) && parsed > 0
      ? Math.floor(parsed)
      : DEFAULT_EXTRACTION_TIMEOUT_MS;
  }

  private getTempBaseDir(): string {
    return process.env.TRANSCRIPTION_VIDEO_TEMP_DIR?.trim() || tmpdir();
  }

  private async cleanupTempDir(tempDir: string): Promise<void> {
    try {
      await fsPromises.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Cleanup failures should not hide extraction or transcription outcomes.
    }
  }
}
