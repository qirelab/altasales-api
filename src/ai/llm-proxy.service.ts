import {
  BadRequestException,
  ForbiddenException,
  GatewayTimeoutException,
  Inject,
  Injectable,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { AiMonitoringService } from './ai-monitoring.service';
import { AiError, isAiError } from './errors/ai-error';
import { AgentId } from './enums/agent-id.enum';
import { AiMonitoringEventName } from './enums/ai-monitoring-event-name.enum';
import { AiMonitoringOperation } from './enums/ai-monitoring-operation.enum';
import { AiMonitoringStage } from './enums/ai-monitoring-stage.enum';
import { AiMonitoringStatus } from './enums/ai-monitoring-status.enum';
import { AnonymizationMode } from './enums/anonymization-mode.enum';
import { DataClass } from './enums/data-class.enum';
import { LlmProvider } from './enums/llm-provider.enum';
import { LlmTask } from './enums/llm-task.enum';
import { LlmChatRequest } from './interfaces/llm-chat-request.interface';
import { LlmChatResponse } from './interfaces/llm-chat-response.interface';
import { LlmMessage } from './interfaces/llm-message.interface';
import { LlmProviderAdapter } from './interfaces/llm-provider-adapter.interface';
import { AnonymizationResult } from './interfaces/pii-anonymization.interface';
import { SafeLlmErrorCode } from './interfaces/safe-llm-log.interface';
import { PiiAnonymizerService } from './pii-anonymizer.service';
import { LLM_PROVIDER_ADAPTERS } from './providers/llm-provider-registry';
import type { LlmProviderRegistry } from './providers/llm-provider-registry';
import { MockLlmProvider } from './providers/mock-llm.provider';
import { executeWithResilience } from './resilience/llm-resilience';

const VALIDATION_ERROR = 'LLM request validation failed';
const POLICY_ERROR = 'LLM request blocked by data policy';
const PROVIDER_POLICY_ERROR = 'LLM provider is not allowed by policy';
const MODEL_POLICY_ERROR = 'LLM model is not allowed by policy';
const PROVIDER_TIMEOUT_ERROR = 'LLM provider timed out';
const PROVIDER_UNAVAILABLE_ERROR = 'LLM provider is unavailable';
const RESTORE_ERROR = 'LLM response restore failed';
const PLACEHOLDER_GUIDANCE =
  'PII placeholders are intentional anonymization tokens. Do not modify, decline, delete, replace, or inflect placeholders. Use neutral constructions where possible, for example "contact person: {{PII_PERSON_0001}}" or "email: {{PII_EMAIL_0001}}".';
const DEFAULT_PROVIDER_TIMEOUT_MS = 10_000;
const DEFAULT_PROVIDER_MAX_ATTEMPTS = 2;
const DEFAULT_PROVIDER_BACKOFF_BASE_MS = 200;
const DEFAULT_PROVIDER_BACKOFF_MAX_MS = 2_000;

type SafeException = Error & {
  safeErrorCode?: SafeLlmErrorCode;
};

@Injectable()
export class LlmProxyService {
  constructor(
    private readonly piiAnonymizer: PiiAnonymizerService,
    private readonly mockProvider: MockLlmProvider,
    private readonly monitoring: AiMonitoringService,
    @Optional()
    @Inject(LLM_PROVIDER_ADAPTERS)
    private readonly providerRegistry?: LlmProviderRegistry,
  ) {}

  async chat(request: LlmChatRequest): Promise<LlmChatResponse> {
    const flowStartedAt = Date.now();
    let currentStage = AiMonitoringStage.Validation;
    let task: LlmTask | undefined;
    let effectiveDataClass: DataClass | undefined;
    let anonymizationStats: Record<string, number> | undefined;
    let provider: LlmProviderAdapter | undefined;
    let fallbackUsed = false;
    let fallbackReasonCode: SafeLlmErrorCode | undefined;

    try {
      this.validateRequest(request);
      task = request.task;

      const declaredDataClass = this.resolveDeclaredDataClass(request);
      const anonymizationMode = this.getAnonymizationMode();
      provider = this.selectProvider(request, 'primary');

      currentStage = AiMonitoringStage.Anonymization;
      const anonymizationResult = await this.resolveAnonymization(
        request.messages,
        declaredDataClass,
        anonymizationMode,
      );

      const providerMessages = this.buildProviderMessages(
        anonymizationResult?.messages ?? request.messages,
        anonymizationResult,
      );

      effectiveDataClass =
        anonymizationResult?.dataClass ??
        this.resolveDisabledModeDataClass(request.messages, declaredDataClass);
      anonymizationStats = anonymizationResult?.stats;

      this.assertProviderPolicy(effectiveDataClass, provider);

      currentStage = AiMonitoringStage.ProviderCall;
      const providerCallResult = await this.callProviderWithOptionalFallback(
        request,
        provider,
        providerMessages,
        effectiveDataClass,
      );
      provider = providerCallResult.provider;
      fallbackUsed = providerCallResult.fallbackUsed;
      fallbackReasonCode = providerCallResult.fallbackReasonCode;
      const providerResponse = providerCallResult.response;

      currentStage = AiMonitoringStage.SafetyScan;
      this.assertProviderResponsePolicy(providerResponse.content);

      currentStage = AiMonitoringStage.Restore;
      const restoredContent = this.restoreProviderResponse(
        providerResponse.content,
        anonymizationResult,
      );

      const response: LlmChatResponse = {
        providerId: provider.providerId,
        modelId: provider.modelId,
        content: restoredContent,
        usage: providerResponse.usage,
        dataClass: effectiveDataClass,
        anonymizationStats,
      };

      this.monitoring.log({
        eventName: AiMonitoringEventName.AiFlowSucceeded,
        operation: AiMonitoringOperation.LlmChat,
        stage: AiMonitoringStage.AiFlow,
        status: AiMonitoringStatus.Success,
        providerAlias: fallbackUsed ? 'fallback' : 'primary',
        modelAlias: 'default',
        providerConfigured: true,
        task: request.task,
        dataClass: response.dataClass,
        effectiveDataClass: response.dataClass,
        tokensIn: response.usage.tokensIn,
        tokensOut: response.usage.tokensOut,
        costRub: response.usage.costRub,
        latencyMs: Date.now() - flowStartedAt,
        anonymizationStats,
        fallbackUsed,
        fallbackReasonCode,
      });

      return response;
    } catch (error) {
      const safeError = this.toSafeException(error);
      const errorCode = this.getErrorCode(safeError);

      this.monitoring.log({
        eventName: AiMonitoringEventName.AiStageFailed,
        operation: AiMonitoringOperation.LlmChat,
        stage: currentStage,
        status: AiMonitoringStatus.Failure,
        task,
        dataClass: effectiveDataClass ?? 'unresolved',
        effectiveDataClass: effectiveDataClass ?? 'unresolved',
        errorCode,
        latencyMs: Date.now() - flowStartedAt,
        anonymizationStats,
        fallbackUsed,
        fallbackReasonCode,
        providerConfigured: Boolean(provider),
      });
      this.monitoring.log({
        eventName: AiMonitoringEventName.AiFlowFailed,
        operation: AiMonitoringOperation.LlmChat,
        stage: AiMonitoringStage.AiFlow,
        status: AiMonitoringStatus.Failure,
        task,
        dataClass: effectiveDataClass ?? 'unresolved',
        effectiveDataClass: effectiveDataClass ?? 'unresolved',
        errorCode,
        latencyMs: Date.now() - flowStartedAt,
        anonymizationStats,
        fallbackUsed,
        fallbackReasonCode,
        providerConfigured: Boolean(provider),
      });
      throw safeError;
    }
  }

  private validateRequest(request: LlmChatRequest): void {
    const hasValidAgent = Object.values(AgentId).includes(request?.agentId);
    const hasValidTask = Object.values(LlmTask).includes(request?.task);
    const hasValidDeclaredDataClass =
      !request?.declaredDataClass ||
      Object.values(DataClass).includes(request.declaredDataClass);
    const hasMessages =
      Array.isArray(request?.messages) && request.messages.length > 0;
    const hasValidMessages =
      hasMessages &&
      request.messages.every((message) => this.isValidMessage(message));

    if (
      !hasValidAgent ||
      !hasValidTask ||
      !hasValidDeclaredDataClass ||
      !hasValidMessages
    ) {
      throw this.safeValidationError();
    }
  }

  private isValidMessage(message: LlmMessage): boolean {
    return Boolean(
      message &&
        ['system', 'user', 'assistant'].includes(message.role) &&
        typeof message.content === 'string' &&
        message.content.trim().length > 0,
    );
  }

  private resolveDeclaredDataClass(
    request: LlmChatRequest,
  ): DataClass | undefined {
    return request.declaredDataClass;
  }

  private async resolveAnonymization(
    messages: LlmMessage[],
    declaredDataClass: DataClass | undefined,
    mode: AnonymizationMode,
  ): Promise<AnonymizationResult | undefined> {
    if (mode === AnonymizationMode.Disabled) {
      return undefined;
    }

    const canSkipForNoPii =
      mode === AnonymizationMode.DisabledForNoPii &&
      declaredDataClass === DataClass.NoPii;
    if (canSkipForNoPii) {
      return undefined;
    }

    try {
      return await this.piiAnonymizer.anonymizeMessages(messages);
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (message === 'validation_error') {
        throw this.safeValidationError();
      }
      throw this.safePolicyError('anonymizer_error');
    }
  }

  private resolveDisabledModeDataClass(
    messages: LlmMessage[],
    declaredDataClass: DataClass | undefined,
  ): DataClass {
    const scan = this.piiAnonymizer.scanMessages(messages);
    if (scan.hasPii) {
      throw this.safePolicyError('policy_blocked');
    }

    return declaredDataClass ?? DataClass.Unknown;
  }

  private buildProviderMessages(
    messages: LlmMessage[],
    anonymizationResult?: AnonymizationResult,
  ): LlmMessage[] {
    if (!anonymizationResult) {
      return messages;
    }

    const descriptions =
      Object.keys(anonymizationResult.semanticPlaceholderDescriptions).length > 0
        ? ` Semantic placeholder descriptions: ${JSON.stringify(
            anonymizationResult.semanticPlaceholderDescriptions,
          )}.`
        : '';

    return [
      {
        role: 'system',
        content: `${PLACEHOLDER_GUIDANCE}${descriptions}`,
      },
      ...anonymizationResult.messages,
    ];
  }

  private selectProvider(
    request: LlmChatRequest,
    role: 'primary' | 'fallback',
  ): LlmProviderAdapter {
    const providerId =
      role === 'primary'
        ? process.env.LLM_PRIMARY_PROVIDER || LlmProvider.Mock
        : process.env.LLM_FALLBACK_PROVIDER;
    const modelId =
      role === 'primary'
        ? process.env.LLM_PRIMARY_MODEL || this.mockProvider.modelId
        : process.env.LLM_FALLBACK_MODEL;

    if (!providerId) {
      throw this.safePolicyError(
        'AI_PROVIDER_NOT_ALLOWED',
        PROVIDER_POLICY_ERROR,
      );
    }

    const provider = this.findProvider(providerId, modelId);
    this.assertProviderAndModelAllowed(provider, request);
    return provider;
  }

  private findProvider(
    providerId: string,
    modelId?: string,
  ): LlmProviderAdapter {
    const providers = this.getRegisteredProviders();
    const provider = providers.find(
      (candidate) =>
        candidate.providerId === providerId &&
        (!modelId || candidate.modelId === modelId),
    );

    if (provider) {
      return provider;
    }

    if (providers.some((candidate) => candidate.providerId === providerId)) {
      throw this.safePolicyError('AI_MODEL_NOT_ALLOWED', MODEL_POLICY_ERROR);
    }

    throw this.safePolicyError('AI_PROVIDER_NOT_ALLOWED', PROVIDER_POLICY_ERROR);
  }

  private getRegisteredProviders(): LlmProviderAdapter[] {
    if (this.providerRegistry?.length) {
      return this.providerRegistry;
    }

    return [this.mockProvider];
  }

  private assertProviderAndModelAllowed(
    provider: LlmProviderAdapter,
    request: LlmChatRequest,
  ): void {
    const requestAllowedProviders = request.policy?.providers;
    if (
      requestAllowedProviders &&
      !requestAllowedProviders.includes(provider.providerId as LlmProvider)
    ) {
      throw this.safePolicyError(
        'AI_PROVIDER_NOT_ALLOWED',
        PROVIDER_POLICY_ERROR,
      );
    }

    const allowedProviders = this.parseCsv(process.env.LLM_ALLOWED_PROVIDERS);
    if (
      allowedProviders.length > 0 &&
      !allowedProviders.includes(provider.providerId)
    ) {
      throw this.safePolicyError(
        'AI_PROVIDER_NOT_ALLOWED',
        PROVIDER_POLICY_ERROR,
      );
    }

    const allowedModels = this.parseCsv(process.env.LLM_ALLOWED_MODELS);
    if (allowedModels.length > 0 && !allowedModels.includes(provider.modelId)) {
      throw this.safePolicyError('AI_MODEL_NOT_ALLOWED', MODEL_POLICY_ERROR);
    }
  }

  private assertProviderPolicy(
    dataClass: DataClass,
    provider: LlmProviderAdapter,
  ): void {
    if (dataClass === DataClass.Unknown || dataClass === DataClass.RawPii) {
      throw this.safePolicyError('policy_blocked');
    }

    if (dataClass === DataClass.HighSensitive && provider.isExternal) {
      throw this.safePolicyError('policy_blocked');
    }
  }

  private async callProviderWithOptionalFallback(
    request: LlmChatRequest,
    provider: LlmProviderAdapter,
    messages: LlmMessage[],
    effectiveDataClass: DataClass,
  ): Promise<{
    provider: LlmProviderAdapter;
    response: Awaited<ReturnType<LlmProviderAdapter['chat']>>;
    fallbackUsed: boolean;
    fallbackReasonCode?: SafeLlmErrorCode;
  }> {
    try {
      return {
        provider,
        response: await this.callProvider(
          request,
          provider,
          messages,
          effectiveDataClass,
          'primary',
        ),
        fallbackUsed: false,
      };
    } catch (error) {
      if (!this.shouldUseFallback(error)) {
        throw error;
      }

      const fallbackReasonCode = this.getErrorCode(error);
      this.monitoring.log({
        eventName: AiMonitoringEventName.AiFallbackAttempted,
        operation: AiMonitoringOperation.LlmChat,
        stage: AiMonitoringStage.Fallback,
        status: AiMonitoringStatus.Failure,
        task: request.task,
        providerAlias: 'primary',
        modelAlias: 'default',
        providerConfigured: true,
        dataClass: effectiveDataClass,
        effectiveDataClass,
        errorCode: fallbackReasonCode,
        fallbackUsed: true,
        fallbackReasonCode,
      });

      try {
        const fallbackProvider = this.selectProvider(request, 'fallback');
        this.assertProviderPolicy(effectiveDataClass, fallbackProvider);
        const response = await this.callProvider(
          request,
          fallbackProvider,
          messages,
          effectiveDataClass,
          'fallback',
        );
        this.monitoring.log({
          eventName: AiMonitoringEventName.AiFallbackSucceeded,
          operation: AiMonitoringOperation.LlmChat,
          stage: AiMonitoringStage.Fallback,
          status: AiMonitoringStatus.Success,
          task: request.task,
          providerAlias: 'fallback',
          modelAlias: 'default',
          providerConfigured: true,
          dataClass: effectiveDataClass,
          effectiveDataClass,
          fallbackUsed: true,
          fallbackReasonCode,
        });

        return {
          provider: fallbackProvider,
          response,
          fallbackUsed: true,
          fallbackReasonCode,
        };
      } catch (fallbackError) {
        this.monitoring.log({
          eventName: AiMonitoringEventName.AiFallbackFailed,
          operation: AiMonitoringOperation.LlmChat,
          stage: AiMonitoringStage.Fallback,
          status: AiMonitoringStatus.Failure,
          task: request.task,
          providerAlias: 'fallback',
          modelAlias: 'default',
          providerConfigured: Boolean(process.env.LLM_FALLBACK_PROVIDER),
          dataClass: effectiveDataClass,
          effectiveDataClass,
          errorCode: this.getErrorCode(fallbackError),
          fallbackUsed: true,
          fallbackReasonCode,
        });
        throw fallbackError;
      }
    }
  }

  private async callProvider(
    request: LlmChatRequest,
    provider: LlmProviderAdapter,
    messages: LlmMessage[],
    effectiveDataClass: DataClass,
    providerAlias: 'primary' | 'fallback',
  ) {
    const timeoutMs = this.getPositiveInteger(
      process.env.LLM_PROVIDER_TIMEOUT_MS,
      DEFAULT_PROVIDER_TIMEOUT_MS,
    );
    const maxAttempts = this.getPositiveInteger(
      process.env.LLM_PROVIDER_MAX_ATTEMPTS,
      DEFAULT_PROVIDER_MAX_ATTEMPTS,
    );
    const backoffBaseMs = this.getPositiveInteger(
      process.env.LLM_PROVIDER_BACKOFF_BASE_MS,
      DEFAULT_PROVIDER_BACKOFF_BASE_MS,
    );
    const backoffMaxMs = this.getPositiveInteger(
      process.env.LLM_PROVIDER_BACKOFF_MAX_MS,
      DEFAULT_PROVIDER_BACKOFF_MAX_MS,
    );

    return executeWithResilience(
      (signal) => provider.chat(messages, { signal }),
      {
        timeoutMs,
        maxAttempts,
        backoffBaseMs,
        backoffMaxMs,
        onAttemptFailure: ({ attempt, maxAttempts, error, latencyMs }) =>
          this.monitoring.log({
            eventName: AiMonitoringEventName.AiRetryAttemptFailed,
            operation: AiMonitoringOperation.LlmChat,
            stage: AiMonitoringStage.Retry,
            status: AiMonitoringStatus.Failure,
            task: request.task,
            providerAlias,
            modelAlias: 'default',
            providerConfigured: true,
            dataClass: effectiveDataClass,
            effectiveDataClass,
            errorCode: error.code,
            attempt,
            maxAttempts,
            latencyMs,
          }),
      },
    );
  }

  private shouldUseFallback(error: unknown): boolean {
    if (process.env.LLM_FALLBACK_ENABLED !== 'true') {
      return false;
    }

    return isAiError(error) && error.fallbackEligible;
  }

  private assertProviderResponsePolicy(content: string): void {
    const scan = this.piiAnonymizer.scanText(content);
    if (scan.hasPii) {
      throw this.safePolicyError('policy_blocked');
    }
  }

  private restoreProviderResponse(
    content: string,
    anonymizationResult?: AnonymizationResult,
  ): string {
    if (!anonymizationResult) {
      return content;
    }

    const restoreResult = this.piiAnonymizer.restoreText(
      content,
      anonymizationResult.placeholderMap,
    );

    if (restoreResult.unresolvedPlaceholders.length > 0) {
      throw this.safeRestoreError();
    }

    return restoreResult.content;
  }

  private getAnonymizationMode(): AnonymizationMode {
    const rawMode = process.env.LLM_ANONYMIZATION_MODE;
    if (
      rawMode &&
      Object.values(AnonymizationMode).includes(rawMode as AnonymizationMode)
    ) {
      return rawMode as AnonymizationMode;
    }

    return AnonymizationMode.Required;
  }

  private safeValidationError(): BadRequestException {
    const error = new BadRequestException(VALIDATION_ERROR) as BadRequestException &
      SafeException;
    error.safeErrorCode = 'AI_VALIDATION_FAILED';
    return error;
  }

  private safeRestoreError(): BadRequestException {
    const error = new BadRequestException(RESTORE_ERROR) as BadRequestException &
      SafeException;
    error.safeErrorCode = 'AI_RESTORE_FAILED';
    return error;
  }

  private safePolicyError(
    code: SafeLlmErrorCode,
    message = POLICY_ERROR,
  ): ForbiddenException {
    const error = new ForbiddenException(message) as ForbiddenException &
      SafeException;
    error.safeErrorCode = code;
    return error;
  }

  private safeProviderUnavailableError(
    code: SafeLlmErrorCode,
  ): ServiceUnavailableException {
    const error = new ServiceUnavailableException(
      PROVIDER_UNAVAILABLE_ERROR,
    ) as ServiceUnavailableException & SafeException;
    error.safeErrorCode = code;
    return error;
  }

  private safeProviderTimeoutError(): GatewayTimeoutException {
    const error = new GatewayTimeoutException(
      PROVIDER_TIMEOUT_ERROR,
    ) as GatewayTimeoutException & SafeException;
    error.safeErrorCode = 'AI_PROVIDER_TIMEOUT';
    return error;
  }

  private toSafeException(error: unknown): Error {
    if (error instanceof BadRequestException || error instanceof ForbiddenException) {
      return error;
    }

    if (error instanceof GatewayTimeoutException) {
      return error;
    }

    if (error instanceof ServiceUnavailableException) {
      return error;
    }

    if (isAiError(error)) {
      if (error.code === 'AI_PROVIDER_TIMEOUT') {
        return this.safeProviderTimeoutError();
      }

      if (
        error.code === 'AI_PROVIDER_UNAVAILABLE' ||
        error.code === 'AI_PROVIDER_RATE_LIMITED' ||
        error.code === 'AI_PROVIDER_HTTP_5XX' ||
        error.code === 'AI_PROVIDER_RETRY_EXHAUSTED' ||
        error.code === 'AI_FALLBACK_NOT_AVAILABLE'
      ) {
        return this.safeProviderUnavailableError(error.code);
      }

      if (
        error.code === 'AI_PROVIDER_NOT_ALLOWED' ||
        error.code === 'AI_MODEL_NOT_ALLOWED' ||
        error.code === 'AI_POLICY_BLOCKED'
      ) {
        return this.safePolicyError(error.code);
      }

      if (error.code === 'AI_RESTORE_FAILED') {
        return this.safeRestoreError();
      }
    }

    return this.safeProviderUnavailableError('AI_PROVIDER_UNAVAILABLE');
  }

  private getErrorCode(error: unknown): SafeLlmErrorCode {
    if (isAiError(error)) {
      return error.code;
    }

    const safeError = error as SafeException;
    if (safeError?.safeErrorCode) {
      return safeError.safeErrorCode;
    }

    if (error instanceof BadRequestException) return 'validation_failed';
    if (error instanceof ForbiddenException) return 'policy_blocked';
    return 'provider_error';
  }

  private parseCsv(value: string | undefined): string[] {
    return (value ?? '')
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);
  }

  private getPositiveInteger(value: string | undefined, fallback: number): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return fallback;
    }

    return parsed;
  }
}
