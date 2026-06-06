import { execFile } from 'child_process';
import * as fsPromises from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { TranscriptionProviderError } from './transcription-provider-error';
import { VideoAudioExtractionService } from './video-audio-extraction.service';

jest.mock('child_process', () => ({
  execFile: jest.fn(),
}));
jest.mock('fs/promises', () => {
  const actual = jest.requireActual<typeof import('fs/promises')>('fs/promises');
  return {
    ...actual,
    rm: jest.fn(actual.rm),
  };
});

describe('VideoAudioExtractionService', () => {
  const env = process.env;
  const execFileMock = execFile as unknown as jest.Mock;
  let tempParent: string;

  beforeEach(async () => {
    process.env = {
      ...env,
      TRANSCRIPTION_FFMPEG_PATH: '/usr/local/bin/ffmpeg',
      TRANSCRIPTION_VIDEO_EXTRACTION_TIMEOUT_MS: '12345',
    };
    tempParent = await fsPromises.mkdtemp(join(tmpdir(), 'video-extraction-test-'));
    process.env.TRANSCRIPTION_VIDEO_TEMP_DIR = tempParent;
    execFileMock.mockReset();
  });

  afterEach(async () => {
    process.env = env;
    jest.restoreAllMocks();
    await fsPromises.rm(tempParent, { recursive: true, force: true });
  });

  it('extracts a video upload to an internal OGG audio file with a safe ffmpeg command', async () => {
    execFileMock.mockImplementationOnce(async (_command, args, _options, callback) => {
      await fsPromises.writeFile(args[args.length - 1], 'ogg audio');
      callback(null, '', '');
    });
    const service = new VideoAudioExtractionService();

    const result = await service.extractAudio(videoFile('demo.mp4', 'video/mp4'));

    expect(execFileMock).toHaveBeenCalledWith(
      '/usr/local/bin/ffmpeg',
      [
        '-y',
        '-i',
        expect.stringMatching(/input\.mp4$/),
        '-vn',
        '-map',
        '0:a:0',
        '-acodec',
        'libopus',
        expect.stringMatching(/extracted-audio\.ogg$/),
      ],
      expect.objectContaining({
        timeout: 12345,
        maxBuffer: 1024 * 1024,
      }),
      expect.any(Function),
    );
    expect(result).toEqual(
      expect.objectContaining({
        originalname: 'extracted-audio.ogg',
        mimetype: 'audio/ogg',
        size: Buffer.byteLength('ogg audio'),
        buffer: Buffer.from('ogg audio'),
      }),
    );
    expect(await fsPromises.readdir(tempParent)).toEqual([]);
  });

  it('uses the uploaded video temp file path without buffering the original video', async () => {
    const uploadDir = await fsPromises.mkdtemp(join(tempParent, 'upload-'));
    const uploadPath = join(uploadDir, 'safe-random-name.mp4');
    await fsPromises.writeFile(uploadPath, 'video on disk');
    execFileMock.mockImplementationOnce(async (_command, args, _options, callback) => {
      await fsPromises.writeFile(args[args.length - 1], 'ogg audio');
      callback(null, '', '');
    });
    const service = new VideoAudioExtractionService();

    const result = await service.extractAudio(
      videoFileFromPath('demo.mp4', 'video/mp4', uploadPath),
    );

    expect(execFileMock).toHaveBeenCalledWith(
      '/usr/local/bin/ffmpeg',
      expect.arrayContaining(['-i', uploadPath]),
      expect.anything(),
      expect.any(Function),
    );
    expect(result).toEqual(
      expect.objectContaining({
        originalname: 'extracted-audio.ogg',
        mimetype: 'audio/ogg',
        buffer: Buffer.from('ogg audio'),
      }),
    );
  });

  it('maps a missing ffmpeg binary to a safe error', async () => {
    execFileMock.mockImplementationOnce((_command, _args, _options, callback) => {
      const error = new Error('spawn ffmpeg ENOENT') as NodeJS.ErrnoException;
      error.code = 'ENOENT';
      callback(error, '', '');
    });
    const service = new VideoAudioExtractionService();

    await expect(
      service.extractAudio(videoFile('demo.mp4', 'video/mp4')),
    ).rejects.toMatchObject<Partial<TranscriptionProviderError>>({
      safeErrorCode: 'TRANSCRIPTION_FFMPEG_UNAVAILABLE',
      message: 'Video audio extraction provider unavailable',
    });
    expect(await fsPromises.readdir(tempParent)).toEqual([]);
  });

  it('maps extraction timeout to a safe error', async () => {
    execFileMock.mockImplementationOnce((_command, _args, _options, callback) => {
      const error = new Error('ffmpeg timeout') as NodeJS.ErrnoException & {
        killed?: boolean;
      };
      error.killed = true;
      callback(error, '', '');
    });
    const service = new VideoAudioExtractionService();

    await expect(
      service.extractAudio(videoFile('demo.mp4', 'video/mp4')),
    ).rejects.toMatchObject<Partial<TranscriptionProviderError>>({
      safeErrorCode: 'TRANSCRIPTION_VIDEO_EXTRACTION_TIMEOUT',
    });
  });

  it('maps missing audio stream to a safe error without exposing ffmpeg output', async () => {
    execFileMock.mockImplementationOnce((_command, _args, _options, callback) => {
      callback(
        new Error('ffmpeg failed'),
        'raw stdout',
        "Stream map '0:a:0' matches no streams. temp/input.mp4",
      );
    });
    const service = new VideoAudioExtractionService();

    await expect(
      service.extractAudio(videoFile('demo.mp4', 'video/mp4')),
    ).rejects.toMatchObject<Partial<TranscriptionProviderError>>({
      safeErrorCode: 'TRANSCRIPTION_VIDEO_AUDIO_STREAM_NOT_FOUND',
      message: 'Video audio stream not found',
    });
  });

  it('does not mask the primary extraction error when temp cleanup fails', async () => {
    execFileMock.mockImplementationOnce((_command, _args, _options, callback) => {
      callback(new Error('raw ffmpeg stderr'), '', 'raw stderr with temp path');
    });
    const rmMock = fsPromises.rm as jest.MockedFunction<typeof fsPromises.rm>;
    rmMock.mockRejectedValueOnce(new Error('cleanup failed'));
    const service = new VideoAudioExtractionService();

    await expect(
      service.extractAudio(videoFile('demo.mp4', 'video/mp4')),
    ).rejects.toMatchObject<Partial<TranscriptionProviderError>>({
      safeErrorCode: 'TRANSCRIPTION_VIDEO_EXTRACTION_FAILED',
      message: 'Video audio extraction failed',
    });
  });
});

function videoFile(
  originalname: string,
  mimetype: string,
): Express.Multer.File {
  const buffer = Buffer.from('video');
  return {
    originalname,
    mimetype,
    size: buffer.length,
    buffer,
  } as Express.Multer.File;
}

function videoFileFromPath(
  originalname: string,
  mimetype: string,
  path: string,
): Express.Multer.File {
  return {
    originalname,
    mimetype,
    size: 1024,
    path,
  } as Express.Multer.File;
}
