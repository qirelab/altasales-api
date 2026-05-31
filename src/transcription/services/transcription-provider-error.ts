export type TranscriptionSafeErrorCode =
  | 'TRANSCRIPTION_DISABLED'
  | 'TRANSCRIPTION_UPLOAD_FAILED'
  | 'TRANSCRIPTION_PROVIDER_UNAVAILABLE'
  | 'TRANSCRIPTION_PROVIDER_TIMEOUT'
  | 'TRANSCRIPTION_PROVIDER_RATE_LIMITED'
  | 'TRANSCRIPTION_RESPONSE_INVALID'
  | 'TRANSCRIPTION_OPERATION_FAILED';

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
