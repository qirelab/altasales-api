import { Injectable, Logger } from '@nestjs/common';
import { AiMonitoringEvent } from './interfaces/ai-monitoring-event.interface';

const URL_LIKE_PATTERN =
  /(?:https?:\/\/|www\.|:\/\/|[a-z0-9-]+\.[a-z]{2,}(?:\/|$))/i;
const SAFE_ANONYMIZATION_STAT_KEYS = new Set([
  'person',
  'phone',
  'email',
  'inn',
  'snils',
  'passport',
  'bank_card',
  'birth_date',
]);

type SafeMonitoringPayload = Record<string, unknown>;

@Injectable()
export class AiMonitoringService {
  private readonly logger = new Logger(AiMonitoringService.name);

  log(event: AiMonitoringEvent): void {
    this.logger.log(this.toSafePayload(event));
  }

  private toSafePayload(event: AiMonitoringEvent): SafeMonitoringPayload {
    return this.omitUndefined({
      eventName: event.eventName,
      operation: event.operation,
      stage: event.stage,
      status: event.status,
      errorCode: event.errorCode,
      latencyMs: event.latencyMs,
      attempt: event.attempt,
      maxAttempts: event.maxAttempts,
      fallbackUsed: event.fallbackUsed,
      fallbackReasonCode: event.fallbackReasonCode,
      providerAlias: this.safeAlias(event.providerAlias),
      modelAlias: this.safeAlias(event.modelAlias),
      providerConfigured: event.providerConfigured,
      task: event.task,
      dataClass: event.dataClass,
      effectiveDataClass: event.effectiveDataClass,
      tokensIn: event.tokensIn,
      tokensOut: event.tokensOut,
      costRub: event.costRub,
      anonymizationStats: this.safeStats(event.anonymizationStats),
    });
  }

  private safeAlias(value: string | undefined): string | undefined {
    if (!value || URL_LIKE_PATTERN.test(value)) {
      return undefined;
    }

    return value;
  }

  private safeStats(
    stats: Record<string, number> | undefined,
  ): Record<string, number> | undefined {
    if (!stats) {
      return undefined;
    }

    const safeEntries = Object.entries(stats).filter(
      ([key, value]) =>
        SAFE_ANONYMIZATION_STAT_KEYS.has(key) &&
        !URL_LIKE_PATTERN.test(key) &&
        Number.isFinite(value),
    );

    return safeEntries.length > 0 ? Object.fromEntries(safeEntries) : undefined;
  }

  private omitUndefined(payload: SafeMonitoringPayload): SafeMonitoringPayload {
    return Object.fromEntries(
      Object.entries(payload).filter(([, value]) => value !== undefined),
    );
  }
}
