import { Logger } from '@nestjs/common';
import { AiMonitoringService } from './ai-monitoring.service';
import { AiMonitoringEventName } from './enums/ai-monitoring-event-name.enum';
import { AiMonitoringOperation } from './enums/ai-monitoring-operation.enum';
import { AiMonitoringStage } from './enums/ai-monitoring-stage.enum';
import { AiMonitoringStatus } from './enums/ai-monitoring-status.enum';
import { LlmTask } from './enums/llm-task.enum';

describe('AiMonitoringService', () => {
  let service: AiMonitoringService;
  let loggerLogSpy: jest.SpyInstance;

  beforeEach(() => {
    loggerLogSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    service = new AiMonitoringService();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('logs only allowlisted fields and removes undefined values', () => {
    service.log({
      eventName: AiMonitoringEventName.AiFlowSucceeded,
      operation: AiMonitoringOperation.LlmChat,
      stage: AiMonitoringStage.AiFlow,
      status: AiMonitoringStatus.Success,
      latencyMs: 42,
      task: LlmTask.Summarize,
      providerAlias: 'primary',
      modelAlias: undefined,
      anonymizationStats: {
        email: 1,
        Authorization: 1,
        'user@example.com': 1,
        'https://provider.test': 1,
      },
      prompt: 'raw prompt user@example.com',
      headers: { Authorization: 'Bearer secret' },
      placeholderMap: { '{{PII_EMAIL_0001}}': 'user@example.com' },
      baseUrl: 'https://provider.test',
      apiKey: 'secret-key',
    } as never);

    expect(loggerLogSpy).toHaveBeenCalledWith({
      eventName: AiMonitoringEventName.AiFlowSucceeded,
      operation: AiMonitoringOperation.LlmChat,
      stage: AiMonitoringStage.AiFlow,
      status: AiMonitoringStatus.Success,
      latencyMs: 42,
      providerAlias: 'primary',
      task: LlmTask.Summarize,
      anonymizationStats: { email: 1 },
    });
  });

  it('drops URL-like provider and model aliases', () => {
    service.log({
      eventName: AiMonitoringEventName.AiRetryAttemptFailed,
      operation: AiMonitoringOperation.LlmChat,
      stage: AiMonitoringStage.Retry,
      status: AiMonitoringStatus.Failure,
      providerAlias: 'https://provider.test',
      modelAlias: 'models.provider.test/default',
      errorCode: 'AI_PROVIDER_TIMEOUT',
    });

    const serializedLog = JSON.stringify(loggerLogSpy.mock.calls[0][0]);
    expect(serializedLog).toContain('AI_PROVIDER_TIMEOUT');
    expect(serializedLog).not.toContain('https://provider.test');
    expect(serializedLog).not.toContain('models.provider.test');
    expect(serializedLog).not.toContain('providerAlias');
    expect(serializedLog).not.toContain('modelAlias');
  });
});
