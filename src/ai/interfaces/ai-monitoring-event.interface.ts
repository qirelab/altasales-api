import { DataClass } from '../enums/data-class.enum';
import { LlmTask } from '../enums/llm-task.enum';
import { AiErrorCode } from '../errors/ai-error';
import { AiMonitoringEventName } from '../enums/ai-monitoring-event-name.enum';
import { AiMonitoringOperation } from '../enums/ai-monitoring-operation.enum';
import { AiMonitoringStage } from '../enums/ai-monitoring-stage.enum';
import { AiMonitoringStatus } from '../enums/ai-monitoring-status.enum';
import { SafeLlmErrorCode } from './safe-llm-log.interface';

export interface AiMonitoringEvent {
  eventName: AiMonitoringEventName;
  operation: AiMonitoringOperation;
  stage: AiMonitoringStage;
  status: AiMonitoringStatus;
  errorCode?: SafeLlmErrorCode | AiErrorCode;
  latencyMs?: number;
  attempt?: number;
  maxAttempts?: number;
  fallbackUsed?: boolean;
  fallbackReasonCode?: SafeLlmErrorCode | AiErrorCode;
  providerAlias?: string;
  modelAlias?: string;
  providerConfigured?: boolean;
  task?: LlmTask;
  dataClass?: DataClass | 'unresolved';
  effectiveDataClass?: DataClass | 'unresolved';
  tokensIn?: number;
  tokensOut?: number;
  costRub?: number;
  anonymizationStats?: Record<string, number>;
  inputCount?: number;
  vectorDimensions?: number;
}
