import { AgentId } from '../enums/agent-id.enum';
import { DataClass } from '../enums/data-class.enum';
import { LlmTask } from '../enums/llm-task.enum';

export type SafeLlmStatus =
  | 'success'
  | 'blocked'
  | 'validation_error'
  | 'provider_error'
  | 'anonymizer_error';

export type SafeLlmErrorCode =
  | 'validation_failed'
  | 'policy_blocked'
  | 'provider_error'
  | 'anonymizer_error';

export interface SafeLlmLogMetadata {
  agentId?: AgentId;
  task?: LlmTask;
  providerId?: string;
  modelId?: string;
  effectiveDataClass?: DataClass | 'unresolved';
  tokensIn?: number;
  tokensOut?: number;
  costRub?: number;
  latencyMs?: number;
  status: SafeLlmStatus;
  errorCode?: SafeLlmErrorCode;
  anonymizationStats?: Record<string, number>;
}
