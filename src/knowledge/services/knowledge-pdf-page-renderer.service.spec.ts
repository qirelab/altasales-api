import { execFile } from 'child_process';
import * as fsPromises from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { ServiceUnavailableException } from '@nestjs/common';
import { KnowledgePdfPageRendererService } from './knowledge-pdf-page-renderer.service';

jest.mock('child_process', () => ({
  execFile: jest.fn(),
}));

describe('KnowledgePdfPageRendererService', () => {
  const originalEnv = process.env;
  let renderer: KnowledgePdfPageRendererService;
  let tempParent: string;
  const execFileMock = execFile as unknown as jest.Mock;

  beforeEach(async () => {
    process.env = {
      ...originalEnv,
      KNOWLEDGE_OCR_MAX_PAGES: '3',
      KNOWLEDGE_OCR_TIMEOUT_MS: '2345',
    };
    tempParent = await fsPromises.mkdtemp(join(tmpdir(), 'knowledge-pdf-renderer-test-'));
    process.env.KNOWLEDGE_OCR_TEMP_DIR = tempParent;
    execFileMock.mockReset();
    renderer = new KnowledgePdfPageRendererService();
  });

  afterEach(async () => {
    process.env = originalEnv;
    jest.restoreAllMocks();
    await fsPromises.rm(tempParent, { recursive: true, force: true });
  });

  it('renders PDF pages through pdftoppm with a page cap', async () => {
    execFileMock.mockImplementationOnce(async (_command, args, _options, callback) => {
      await fsPromises.writeFile(`${args[args.length - 1]}-2.png`, 'page 2');
      await fsPromises.writeFile(`${args[args.length - 1]}-1.png`, 'page 1');
      callback(null, '', '');
    });

    const result = await renderer.render(Buffer.from('pdf'));

    expect(execFileMock).toHaveBeenCalledWith(
      'pdftoppm',
      [
        '-r',
        '200',
        '-png',
        '-f',
        '1',
        '-l',
        '3',
        expect.stringMatching(/input\.pdf$/),
        expect.stringMatching(/page$/),
      ],
      expect.objectContaining({ timeout: 2345 }),
      expect.any(Function),
    );
    expect(result.pages.map((page) => page.pageNumber)).toEqual([1, 2]);

    await renderer.cleanup(result.tempDir);
  });

  it('cleans up temporary files when rendering fails', async () => {
    execFileMock.mockImplementationOnce((_command, _args, _options, callback) => {
      callback(new Error('render failed'), '', '');
    });

    await expect(renderer.render(Buffer.from('pdf'))).rejects.toThrow(
      'Knowledge PDF OCR rendering failed',
    );
  });

  it('preserves the render error when cleanup also fails', async () => {
    execFileMock.mockImplementationOnce(async (_command, _args, _options, callback) => {
      await fsPromises.chmod(tempParent, 0o500);
      callback(new Error('render failed'), '', '');
    });

    try {
      await expect(renderer.render(Buffer.from('pdf'))).rejects.toThrow(
        'Knowledge PDF OCR rendering failed',
      );
    } finally {
      await fsPromises.chmod(tempParent, 0o700);
    }
  });

  it('maps a missing pdftoppm binary to a safe service error', async () => {
    execFileMock.mockImplementationOnce((_command, _args, _options, callback) => {
      const error = new Error('spawn pdftoppm ENOENT') as NodeJS.ErrnoException;
      error.code = 'ENOENT';
      callback(error, '', '');
    });

    await expect(renderer.render(Buffer.from('pdf'))).rejects.toThrow(
      ServiceUnavailableException,
    );
  });
});
