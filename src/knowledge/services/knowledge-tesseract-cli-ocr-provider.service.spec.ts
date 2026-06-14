import { execFile } from 'child_process';
import * as fsPromises from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { ServiceUnavailableException } from '@nestjs/common';
import { KnowledgeTesseractCliOcrProvider } from './knowledge-tesseract-cli-ocr-provider.service';

jest.mock('child_process', () => ({
  execFile: jest.fn(),
}));

describe('KnowledgeTesseractCliOcrProvider', () => {
  const originalEnv = process.env;
  let provider: KnowledgeTesseractCliOcrProvider;
  let tempParent: string;
  const execFileMock = execFile as unknown as jest.Mock;

  beforeEach(async () => {
    process.env = {
      ...originalEnv,
      KNOWLEDGE_OCR_LANGUAGES: 'rus+eng',
      KNOWLEDGE_OCR_TIMEOUT_MS: '1234',
    };
    tempParent = await fsPromises.mkdtemp(join(tmpdir(), 'knowledge-ocr-provider-test-'));
    process.env.KNOWLEDGE_OCR_TEMP_DIR = tempParent;
    execFileMock.mockReset();
    provider = new KnowledgeTesseractCliOcrProvider();
  });

  afterEach(async () => {
    process.env = originalEnv;
    jest.restoreAllMocks();
    await fsPromises.rm(tempParent, { recursive: true, force: true });
  });

  it('runs tesseract through execFile with language, timeout, and thread limit', async () => {
    execFileMock.mockImplementationOnce((_command, _args, _options, callback) => {
      callback(null, 'recognized text', '');
    });

    const text = await provider.recognizeImageBuffer(Buffer.from('image'), {
      extension: '.png',
    });

    expect(text).toBe('recognized text');
    expect(execFileMock).toHaveBeenCalledWith(
      'tesseract',
      [expect.stringMatching(/input\.png$/), 'stdout', '-l', 'rus+eng'],
      expect.objectContaining({
        timeout: 1234,
        env: expect.objectContaining({ OMP_THREAD_LIMIT: '1' }),
      }),
      expect.any(Function),
    );
  });

  it('removes temporary image files after OCR completes', async () => {
    execFileMock.mockImplementationOnce((_command, _args, _options, callback) => {
      callback(null, 'recognized text', '');
    });

    await provider.recognizeImageBuffer(Buffer.from('image'), {
      extension: '.jpeg',
    });

    await expect(fsPromises.readdir(tempParent)).resolves.toEqual([]);
  });

  it('preserves the OCR error when cleanup also fails', async () => {
    execFileMock.mockImplementationOnce(async (_command, _args, _options, callback) => {
      await fsPromises.chmod(tempParent, 0o500);
      callback(new Error('ocr failed'), '', '');
    });

    try {
      await expect(
        provider.recognizeImageBuffer(Buffer.from('image'), {
          extension: '.png',
        }),
      ).rejects.toThrow('Knowledge OCR failed');
    } finally {
      await fsPromises.chmod(tempParent, 0o700);
    }
  });

  it('returns OCR text when cleanup fails after success', async () => {
    execFileMock.mockImplementationOnce(async (_command, _args, _options, callback) => {
      await fsPromises.chmod(tempParent, 0o500);
      callback(null, 'recognized text', '');
    });

    try {
      await expect(
        provider.recognizeImageBuffer(Buffer.from('image'), {
          extension: '.png',
        }),
      ).resolves.toBe('recognized text');
    } finally {
      await fsPromises.chmod(tempParent, 0o700);
    }
  });

  it('maps a missing tesseract binary to a safe service error', async () => {
    execFileMock.mockImplementationOnce((_command, _args, _options, callback) => {
      const error = new Error('spawn tesseract ENOENT') as NodeJS.ErrnoException;
      error.code = 'ENOENT';
      callback(error, '', '');
    });

    await expect(provider.recognizeImageFile('/tmp/input.png')).rejects.toThrow(
      ServiceUnavailableException,
    );
  });
});
