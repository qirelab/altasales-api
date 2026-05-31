import { GUARDS_METADATA } from '@nestjs/common/constants';
import { SessionGuard } from '../auth/guards/session.guard';
import {
  isSupportedTranscriptionAudioFile,
  TranscriptionController,
} from './transcription.controller';

describe('Transcription upload validation', () => {
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
});
