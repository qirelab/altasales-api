import { RequestMethod } from '@nestjs/common';
import {
  GUARDS_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';
import { SessionGuard } from '../auth/guards/session.guard';
import {
  getMaxVideoSizeBytes,
  isSupportedTranscriptionAudioFile,
  isSupportedTranscriptionVideoFile,
  TranscriptionController,
} from './transcription.controller';

describe('Transcription upload validation', () => {
  const env = process.env;

  afterEach(() => {
    process.env = env;
  });

  it('uses session authentication at controller level', () => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, TranscriptionController);

    expect(guards).toEqual([SessionGuard]);
  });

  it.each([
    ['call.mp3', 'audio/mpeg'],
    ['call.wav', 'audio/wav'],
    ['call.wav', 'audio/x-wav'],
    ['call.ogg', 'audio/ogg'],
  ])('allows supported audio format %s with %s', (originalname, mimetype) => {
    expect(
      isSupportedTranscriptionAudioFile({ originalname, mimetype }),
    ).toBe(true);
  });

  it.each([
    ['call.wav', 'audio/mpeg'],
    ['call.mp3', 'audio/wav'],
    ['call.ogg', 'application/octet-stream'],
    ['call.webm', 'audio/webm'],
    ['call.m4a', 'audio/mp4'],
    ['clip.mp4', 'video/mp4'],
  ])('rejects unsupported or mismatched pair %s with %s', (originalname, mimetype) => {
    expect(
      isSupportedTranscriptionAudioFile({ originalname, mimetype }),
    ).toBe(false);
  });

  it('exposes a POST /transcription/video upload route', () => {
    expect(Reflect.getMetadata(PATH_METADATA, TranscriptionController.prototype.uploadVideo))
      .toBe('video');
    expect(Reflect.getMetadata(METHOD_METADATA, TranscriptionController.prototype.uploadVideo))
      .toBe(RequestMethod.POST);
  });

  it.each([
    ['demo.mp4', 'video/mp4'],
    ['demo.webm', 'video/webm'],
    ['demo.mov', 'video/quicktime'],
  ])('allows supported video format %s with %s', (originalname, mimetype) => {
    expect(
      isSupportedTranscriptionVideoFile({ originalname, mimetype }),
    ).toBe(true);
  });

  it.each([
    ['demo.webm', 'video/mp4'],
    ['demo.mp4', 'video/webm'],
    ['demo.mkv', 'video/x-matroska'],
    ['demo.avi', 'video/x-msvideo'],
    ['demo.m4v', 'video/mp4'],
    ['call.mp3', 'audio/mpeg'],
    ['call.wav', 'audio/wav'],
  ])('rejects unsupported or mismatched video pair %s with %s', (originalname, mimetype) => {
    expect(
      isSupportedTranscriptionVideoFile({ originalname, mimetype }),
    ).toBe(false);
  });

  it('uses a separate configured video upload size limit', () => {
    process.env = {
      ...env,
      TRANSCRIPTION_MAX_VIDEO_SIZE_MB: '321',
    };

    expect(getMaxVideoSizeBytes()).toBe(321 * 1024 * 1024);
  });
});
