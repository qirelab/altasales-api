import { Injectable } from '@nestjs/common';
import {
  AnonymizerProvider,
  AnonymizerProviderRequest,
} from '../interfaces/anonymizer-provider.interface';

const DEFAULT_TIMEOUT_MS = 10_000;

@Injectable()
export class AnonymizerLlmProvider implements AnonymizerProvider {
  async anonymize(request: AnonymizerProviderRequest): Promise<string> {
    const baseUrl = process.env.LLM_ANONYMIZER_BASE_URL;
    const apiKey = process.env.LLM_ANONYMIZER_API_KEY;
    const model = process.env.LLM_ANONYMIZER_MODEL;
    const timeoutMs = this.getTimeoutMs();

    if (!baseUrl || !apiKey || !model) {
      throw new Error('anonymizer_unavailable');
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
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
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error('anonymizer_unavailable');
      }

      return response.text();
    } catch {
      throw new Error('anonymizer_unavailable');
    } finally {
      clearTimeout(timeout);
    }
  }

  private getTimeoutMs(): number {
    const parsed = Number(process.env.LLM_ANONYMIZER_TIMEOUT_MS);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return DEFAULT_TIMEOUT_MS;
    }

    return parsed;
  }
}
