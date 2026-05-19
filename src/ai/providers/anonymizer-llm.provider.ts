import { Injectable } from '@nestjs/common';
import {
  AnonymizerProvider,
  AnonymizerProviderRequest,
} from '../interfaces/anonymizer-provider.interface';
import { executeWithResilience } from '../resilience/llm-resilience';

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_ATTEMPTS = 2;
const DEFAULT_BACKOFF_BASE_MS = 200;
const DEFAULT_BACKOFF_MAX_MS = 1_000;

@Injectable()
export class AnonymizerLlmProvider implements AnonymizerProvider {
  async anonymize(request: AnonymizerProviderRequest): Promise<string> {
    const baseUrl = process.env.LLM_ANONYMIZER_BASE_URL;
    const apiKey = process.env.LLM_ANONYMIZER_API_KEY;
    const model = process.env.LLM_ANONYMIZER_MODEL;
    const timeoutMs = this.getPositiveInteger(
      process.env.LLM_ANONYMIZER_TIMEOUT_MS,
      DEFAULT_TIMEOUT_MS,
    );
    const maxAttempts = this.getPositiveInteger(
      process.env.LLM_ANONYMIZER_MAX_ATTEMPTS,
      DEFAULT_MAX_ATTEMPTS,
    );
    const backoffBaseMs = this.getPositiveInteger(
      process.env.LLM_ANONYMIZER_BACKOFF_BASE_MS,
      DEFAULT_BACKOFF_BASE_MS,
    );
    const backoffMaxMs = this.getPositiveInteger(
      process.env.LLM_ANONYMIZER_BACKOFF_MAX_MS,
      DEFAULT_BACKOFF_MAX_MS,
    );

    if (!baseUrl || !apiKey || !model) {
      throw new Error('anonymizer_unavailable');
    }

    try {
      return await executeWithResilience(
        async (signal) => {
          const response = await fetch(baseUrl, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${apiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              model,
              messages: request.messages,
            }),
            signal,
          });

          if (!response.ok) {
            throw Object.assign(new Error('anonymizer_unavailable'), {
              status: response.status,
            });
          }

          return response.text();
        },
        {
          timeoutMs,
          maxAttempts,
          backoffBaseMs,
          backoffMaxMs,
        },
      );
    } catch {
      throw new Error('anonymizer_unavailable');
    }
  }

  private getPositiveInteger(value: string | undefined, fallback: number): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return fallback;
    }

    return parsed;
  }
}
