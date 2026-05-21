export enum AiMonitoringStage {
  AiFlow = 'AI_FLOW',
  Validation = 'VALIDATION',
  Anonymization = 'ANONYMIZATION',
  ProviderCall = 'PROVIDER_CALL',
  Retry = 'RETRY',
  Fallback = 'FALLBACK',
  SafetyScan = 'SAFETY_SCAN',
  Restore = 'RESTORE',
}
