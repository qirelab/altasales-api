export enum AiMonitoringEventName {
  AiFlowStarted = 'AI_FLOW_STARTED',
  AiFlowSucceeded = 'AI_FLOW_SUCCEEDED',
  AiFlowFailed = 'AI_FLOW_FAILED',
  AiStageSucceeded = 'AI_STAGE_SUCCEEDED',
  AiStageFailed = 'AI_STAGE_FAILED',
  AiRetryAttemptFailed = 'AI_RETRY_ATTEMPT_FAILED',
  AiFallbackAttempted = 'AI_FALLBACK_ATTEMPTED',
  AiFallbackSucceeded = 'AI_FALLBACK_SUCCEEDED',
  AiFallbackFailed = 'AI_FALLBACK_FAILED',
}
