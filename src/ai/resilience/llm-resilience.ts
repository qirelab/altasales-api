import { AiError, normalizeProviderError } from '../errors/ai-error';

export type ResilienceAttemptMetadata = {
  attempt: number;
  maxAttempts: number;
  error: AiError;
  delayMs?: number;
  latencyMs: number;
};

type ResilienceOptions = {
  timeoutMs: number;
  maxAttempts: number;
  backoffBaseMs: number;
  backoffMaxMs: number;
  onAttemptFailure?: (metadata: ResilienceAttemptMetadata) => void;
};

export async function executeWithResilience<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  options: ResilienceOptions,
): Promise<T> {
  const maxAttempts = Math.max(1, options.maxAttempts);

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const startedAt = Date.now();
    try {
      return await withTimeout(operation, options.timeoutMs);
    } catch (error) {
      const normalizedError = normalizeProviderError(error);
      const canRetry = normalizedError.retryable && attempt < maxAttempts;
      const delayMs = canRetry
        ? getBackoffDelay(attempt, options.backoffBaseMs, options.backoffMaxMs)
        : undefined;

      options.onAttemptFailure?.({
        attempt,
        maxAttempts,
        error: normalizedError,
        delayMs,
        latencyMs: Date.now() - startedAt,
      });

      if (!canRetry) {
        throw normalizedError;
      }

      await sleep(delayMs);
    }
  }

  throw new AiError('AI_PROVIDER_RETRY_EXHAUSTED', 'provider_retry_exhausted', {
    retryable: false,
    fallbackEligible: true,
  });
}

export function getBackoffDelay(
  attempt: number,
  baseMs: number,
  maxMs: number,
): number {
  const safeBase = Math.max(0, baseMs);
  const safeMax = Math.max(safeBase, maxMs);
  return Math.min(safeBase * 2 ** (attempt - 1), safeMax);
}

function withTimeout<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
): Promise<T> {
  const safeTimeoutMs = Math.max(1, timeoutMs);
  const controller = new AbortController();

  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => {
      controller.abort();
      reject(
        new AiError('AI_PROVIDER_TIMEOUT', 'provider_timeout', {
          retryable: true,
          fallbackEligible: true,
        }),
      );
    }, safeTimeoutMs);

    operation(controller.signal)
      .then(resolve)
      .catch(reject)
      .finally(() => clearTimeout(timeout));
  });
}

function sleep(delayMs = 0): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}
