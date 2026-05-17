export type AiErrorCode =
  | 'AI_PROVIDER_TIMEOUT'
  | 'AI_PROVIDER_RETRY_EXHAUSTED'
  | 'AI_PROVIDER_UNAVAILABLE'
  | 'AI_PROVIDER_RATE_LIMITED'
  | 'AI_PROVIDER_HTTP_5XX'
  | 'AI_FALLBACK_NOT_AVAILABLE'
  | 'AI_MODEL_NOT_ALLOWED'
  | 'AI_PROVIDER_NOT_ALLOWED'
  | 'AI_ANONYMIZATION_FAILED'
  | 'AI_RESTORE_FAILED'
  | 'AI_VALIDATION_FAILED'
  | 'AI_POLICY_BLOCKED';

type AiErrorOptions = {
  retryable?: boolean;
  fallbackEligible?: boolean;
  status?: number;
};

export class AiError extends Error {
  readonly code: AiErrorCode;
  readonly retryable: boolean;
  readonly fallbackEligible: boolean;
  readonly status?: number;

  constructor(code: AiErrorCode, message: string, options: AiErrorOptions = {}) {
    super(message);
    this.name = 'AiError';
    this.code = code;
    this.retryable = options.retryable ?? false;
    this.fallbackEligible = options.fallbackEligible ?? false;
    this.status = options.status;
  }
}

export function isAiError(error: unknown): error is AiError {
  return error instanceof AiError;
}

export function normalizeProviderError(error: unknown): AiError {
  if (isAiError(error)) {
    return error;
  }

  const status = getStatus(error);
  if (status === 429) {
    return new AiError('AI_PROVIDER_RATE_LIMITED', 'provider_rate_limited', {
      retryable: true,
      fallbackEligible: true,
      status,
    });
  }

  if (status && status >= 500) {
    return new AiError('AI_PROVIDER_HTTP_5XX', 'provider_5xx', {
      retryable: true,
      fallbackEligible: true,
      status,
    });
  }

  if (status && status >= 400) {
    return new AiError('AI_PROVIDER_UNAVAILABLE', 'provider_4xx', {
      retryable: false,
      fallbackEligible: false,
      status,
    });
  }

  if (error instanceof DOMException && error.name === 'AbortError') {
    return new AiError('AI_PROVIDER_TIMEOUT', 'provider_timeout', {
      retryable: true,
      fallbackEligible: true,
    });
  }

  return new AiError('AI_PROVIDER_UNAVAILABLE', 'provider_unavailable', {
    retryable: true,
    fallbackEligible: true,
  });
}

function getStatus(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') {
    return undefined;
  }

  const directStatus = (error as { status?: unknown }).status;
  if (typeof directStatus === 'number') {
    return directStatus;
  }

  const responseStatus = (error as { response?: { status?: unknown } }).response
    ?.status;
  return typeof responseStatus === 'number' ? responseStatus : undefined;
}
