export type TranscriptionSafeErrorCode =
  | 'TRANSCRIPTION_DISABLED'
  | 'TRANSCRIPTION_CONFIG_MISSING'
  | 'TRANSCRIPTION_UPLOAD_FAILED'
  | 'TRANSCRIPTION_PROVIDER_UNAVAILABLE'
  | 'TRANSCRIPTION_PROVIDER_TIMEOUT'
  | 'TRANSCRIPTION_PROVIDER_RATE_LIMITED'
  | 'TRANSCRIPTION_RESPONSE_INVALID'
  | 'TRANSCRIPTION_OPERATION_FAILED'
  | 'TRANSCRIPTION_OBJECT_CLEANUP_FAILED'
  | 'TRANSCRIPTION_VIDEO_EXTRACTION_FAILED'
  | 'TRANSCRIPTION_VIDEO_EXTRACTION_TIMEOUT'
  | 'TRANSCRIPTION_VIDEO_UPLOAD_CLEANUP_FAILED'
  | 'TRANSCRIPTION_EXTRACTED_AUDIO_TOO_LARGE'
  | 'TRANSCRIPTION_FFMPEG_UNAVAILABLE'
  | 'TRANSCRIPTION_VIDEO_AUDIO_STREAM_NOT_FOUND';

export class TranscriptionProviderError extends Error {
  constructor(
    readonly safeErrorCode: TranscriptionSafeErrorCode,
    message = 'Transcription provider failed',
  ) {
    super(message);
    this.name = 'TranscriptionProviderError';
  }
}

export function isTranscriptionProviderError(
  error: unknown,
): error is TranscriptionProviderError {
  return error instanceof TranscriptionProviderError;
}
