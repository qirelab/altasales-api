import { Injectable, Optional } from '@nestjs/common';
import { AiMonitoringService } from '../ai-monitoring.service';
import { AiMonitoringEventName } from '../enums/ai-monitoring-event-name.enum';
import { AiMonitoringOperation } from '../enums/ai-monitoring-operation.enum';
import { AiMonitoringStage } from '../enums/ai-monitoring-stage.enum';
import { AiMonitoringStatus } from '../enums/ai-monitoring-status.enum';
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
  constructor(
    @Optional()
    private readonly monitoring?: AiMonitoringService,
  ) {}

  async anonymize(request: AnonymizerProviderRequest): Promise<string> {
    const startedAt = Date.now();
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
      this.logStageFailure(startedAt, false);
      throw new Error('anonymizer_unavailable');
    }

    try {
      const response = await executeWithResilience(
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
          onAttemptFailure: ({ attempt, maxAttempts, error, latencyMs }) =>
            this.monitoring?.log({
              eventName: AiMonitoringEventName.AiRetryAttemptFailed,
              operation: AiMonitoringOperation.AnonymizerLlm,
              stage: AiMonitoringStage.Retry,
              status: AiMonitoringStatus.Failure,
              errorCode: error.code,
              latencyMs,
              attempt,
              maxAttempts,
              providerConfigured: true,
            }),
        },
      );
      this.monitoring?.log({
        eventName: AiMonitoringEventName.AiStageSucceeded,
        operation: AiMonitoringOperation.AnonymizerLlm,
        stage: AiMonitoringStage.ProviderCall,
        status: AiMonitoringStatus.Success,
        latencyMs: Date.now() - startedAt,
        providerConfigured: true,
      });
      return response;
    } catch {
      this.logStageFailure(startedAt, true);
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

  private logStageFailure(startedAt: number, providerConfigured: boolean): void {
    this.monitoring?.log({
      eventName: AiMonitoringEventName.AiStageFailed,
      operation: AiMonitoringOperation.AnonymizerLlm,
      stage: AiMonitoringStage.ProviderCall,
      status: AiMonitoringStatus.Failure,
      errorCode: 'AI_ANONYMIZATION_FAILED',
      latencyMs: Date.now() - startedAt,
      providerConfigured,
    });
  }
}
