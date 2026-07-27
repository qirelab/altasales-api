import {
  BadRequestException,
  ForbiddenException,
  GatewayTimeoutException,
  Inject,
  Injectable,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { AiCacheService } from './ai-cache.service';
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
import { LlmChatStreamEvent } from './interfaces/llm-chat-stream-event.interface';
import { LlmMessage } from './interfaces/llm-message.interface';
import { LlmProviderAdapter } from './interfaces/llm-provider-adapter.interface';
import { LlmProviderStreamEvent } from './interfaces/llm-provider-stream-event.interface';
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
const PROVIDER_CONFIG_ERROR = 'LLM provider configuration is invalid';
const PROVIDER_TIMEOUT_ERROR = 'LLM provider timed out';
const PROVIDER_UNAVAILABLE_ERROR = 'LLM provider is unavailable';
const RESTORE_ERROR = 'LLM response restore failed';
const PLACEHOLDER_GUIDANCE =
  'PII placeholders are intentional anonymization tokens. ' +
  'Do not modify, decline, delete, replace, or inflect placeholders. ' +
  'Use neutral constructions where possible, for example ' +
  '"contact person: {{PII_PERSON_0001}}" or "email: {{PII_EMAIL_0001}}".';
const DEFAULT_PROVIDER_TIMEOUT_MS = 10_000;
const DEFAULT_PROVIDER_MAX_ATTEMPTS = 2;
const DEFAULT_PROVIDER_BACKOFF_BASE_MS = 200;
const DEFAULT_PROVIDER_BACKOFF_MAX_MS = 2_000;
const DEFAULT_FALLBACK_PROVIDER_TIMEOUT_MS = 10_000;
const DEFAULT_FALLBACK_PROVIDER_MAX_ATTEMPTS = 1;
const DEFAULT_FALLBACK_PROVIDER_BACKOFF_BASE_MS = 200;
const DEFAULT_FALLBACK_PROVIDER_BACKOFF_MAX_MS = 1_000;

type SafeException = Error & {
  safeErrorCode?: SafeLlmErrorCode;
};

type ProviderCallResult = {
  response?: Awaited<ReturnType<LlmProviderAdapter['chat']>>;
  cachedResponse?: CachedChatResponse;
  cacheKey?: string;
  cacheHit?: boolean;
};

type CachedChatResponse = Omit<LlmChatResponse, 'cacheKey' | 'cacheHit'>;

type ProviderSelectionResult = ProviderCallResult & {
  provider: LlmProviderAdapter;
  fallbackUsed: boolean;
  fallbackReasonCode?: SafeLlmErrorCode;
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
    @Optional()
    private readonly aiCache?: AiCacheService,
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
    let cacheKey: string | undefined;
    let cacheHit: boolean | undefined;

    try {
      this.validateRequest(request);
      task = request.task;
      this.assertFallbackConfig();

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
        this.resolveUnanonymizedDataClass(
          request.messages,
          declaredDataClass,
          anonymizationMode,
        );
      anonymizationStats = anonymizationResult?.stats;
      const cacheEligible = this.isCacheEligible(
        request,
        declaredDataClass,
        effectiveDataClass,
        anonymizationMode,
        anonymizationResult,
      );

      this.assertProviderPolicy(
        effectiveDataClass,
        provider,
        anonymizationMode,
      );

      currentStage = AiMonitoringStage.ProviderCall;
      const providerCallResult = await this.callProviderWithOptionalFallback(
        request,
        provider,
        providerMessages,
        effectiveDataClass,
        anonymizationMode,
        cacheEligible,
      );
      provider = providerCallResult.provider;
      fallbackUsed = providerCallResult.fallbackUsed;
      fallbackReasonCode = providerCallResult.fallbackReasonCode;
      cacheKey = providerCallResult.cacheKey;
      cacheHit = providerCallResult.cacheHit;
      if (providerCallResult.cachedResponse) {
        const response: LlmChatResponse = {
          ...providerCallResult.cachedResponse,
          cacheKey,
          cacheHit,
        };

        this.logFlowSucceeded({
          request,
          response,
          fallbackUsed,
          fallbackReasonCode,
          anonymizationStats,
          startedAt: flowStartedAt,
        });

        return response;
      }

      const providerResponse = providerCallResult.response;
      if (!providerResponse) {
        throw this.safeProviderUnavailableError('AI_PROVIDER_UNAVAILABLE');
      }

      currentStage = AiMonitoringStage.SafetyScan;
      this.assertProviderResponsePolicy(
        providerResponse.content,
        anonymizationMode,
      );

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
        cacheKey,
        cacheHit,
      };

      this.writeSafeCachedResponse(
        cacheKey,
        cacheHit,
        response,
        request.policy?.cacheTtlMs,
        anonymizationMode,
      );
      this.logFlowSucceeded({
        request,
        response,
        fallbackUsed,
        fallbackReasonCode,
        anonymizationStats,
        startedAt: flowStartedAt,
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

  private resolveUnanonymizedDataClass(
    messages: LlmMessage[],
    declaredDataClass: DataClass | undefined,
    mode: AnonymizationMode,
  ): DataClass {
    if (mode === AnonymizationMode.Disabled) {
      if (this.piiAnonymizer.scanMessages(messages).hasPii) {
        return DataClass.RawPii;
      }

      return declaredDataClass ?? DataClass.RawPii;
    }

    const scan = this.piiAnonymizer.scanMessages(messages);
    if (scan.hasPii) {
      throw this.safePolicyError('policy_blocked');
    }

    if (declaredDataClass) {
      return declaredDataClass;
    }

    return DataClass.Unknown;
  }

  private buildProviderMessages(
    messages: LlmMessage[],
    anonymizationResult?: AnonymizationResult,
  ): LlmMessage[] {
    if (!anonymizationResult) {
      return messages;
    }

    const semanticDescriptions =
      anonymizationResult.semanticPlaceholderDescriptions;
    const serializedDescriptions = JSON.stringify(semanticDescriptions);
    const descriptions =
      Object.keys(semanticDescriptions).length > 0
        ? ` Semantic placeholder descriptions: ${serializedDescriptions}.`
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
        ? process.env.LLM_PRIMARY_MODEL_ALIAS || this.mockProvider.modelId
        : process.env.LLM_FALLBACK_MODEL_ALIAS;

    if (!providerId) {
      throw this.safePolicyError(
        'AI_PROVIDER_NOT_ALLOWED',
        PROVIDER_POLICY_ERROR,
      );
    }

    const provider = this.findProvider(providerId, modelId, role);
    this.assertProviderAndModelAllowed(provider, request);
    return provider;
  }

  private findProvider(
    providerId: string,
    modelId?: string,
    role: 'primary' | 'fallback' = 'primary',
  ): LlmProviderAdapter {
    const providers = this.getRegisteredProviders();
    const provider = providers.find(
      (candidate) =>
        candidate.providerId === providerId &&
        (!modelId || candidate.modelId === modelId) &&
        this.getProviderRole(candidate) === role,
    );

    if (provider) {
      return provider;
    }

    if (providers.some((candidate) => candidate.providerId === providerId)) {
      throw this.safePolicyError('AI_MODEL_NOT_ALLOWED', MODEL_POLICY_ERROR);
    }

    throw this.safePolicyError(
      'AI_PROVIDER_NOT_ALLOWED',
      PROVIDER_POLICY_ERROR,
    );
  }

  private getProviderRole(
    provider: LlmProviderAdapter,
  ): 'primary' | 'fallback' {
    return provider.providerRole ?? 'primary';
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

    const allowedModels = this.parseCsv(process.env.LLM_ALLOWED_MODEL_ALIASES);
    if (allowedModels.length > 0 && !allowedModels.includes(provider.modelId)) {
      throw this.safePolicyError('AI_MODEL_NOT_ALLOWED', MODEL_POLICY_ERROR);
    }
  }

  private assertProviderPolicy(
    dataClass: DataClass,
    provider: LlmProviderAdapter,
    mode: AnonymizationMode,
  ): void {
    if (mode === AnonymizationMode.Disabled) {
      return;
    }

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
    anonymizationMode: AnonymizationMode,
    cacheEligible: boolean,
  ): Promise<ProviderSelectionResult> {
    try {
      const callResult = await this.callProvider(
        request,
        provider,
        messages,
        effectiveDataClass,
        'primary',
        cacheEligible,
      );

      return {
        provider,
        ...callResult,
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
        modelAlias: provider.modelId,
        providerConfigured: true,
        dataClass: effectiveDataClass,
        effectiveDataClass,
        errorCode: fallbackReasonCode,
        fallbackUsed: true,
        fallbackReasonCode,
      });

      try {
        const fallbackProvider = this.selectProvider(request, 'fallback');
        this.assertProviderPolicy(
          effectiveDataClass,
          fallbackProvider,
          anonymizationMode,
        );
        const callResult = await this.callProvider(
          request,
          fallbackProvider,
          messages,
          effectiveDataClass,
          'fallback',
          cacheEligible,
        );
        this.monitoring.log({
          eventName: AiMonitoringEventName.AiFallbackSucceeded,
          operation: AiMonitoringOperation.LlmChat,
          stage: AiMonitoringStage.Fallback,
          status: AiMonitoringStatus.Success,
          task: request.task,
          providerAlias: 'fallback',
          modelAlias: fallbackProvider.modelId,
          providerConfigured: true,
          dataClass: effectiveDataClass,
          effectiveDataClass,
          fallbackUsed: true,
          fallbackReasonCode,
        });

        return {
          provider: fallbackProvider,
          ...callResult,
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
          modelAlias: this.safeFallbackModelAlias(),
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
    cacheEligible: boolean,
  ): Promise<ProviderCallResult> {
    const providerCall = () =>
      this.executeProviderCall(
        request,
        provider,
        messages,
        effectiveDataClass,
        providerAlias,
      );

    if (!this.aiCache || !cacheEligible) {
      return { response: await providerCall() };
    }

    const cacheKey = this.aiCache.buildKey(
      'llm:chat',
      this.buildCachePayload(
        request,
        provider,
        messages,
        effectiveDataClass,
        providerAlias,
      ),
    );
    const cached = this.aiCache.read<CachedChatResponse>(cacheKey);

    if (cached) {
      return { cachedResponse: cached, cacheKey, cacheHit: true };
    }

    return { response: await providerCall(), cacheKey, cacheHit: false };
  }

  private async executeProviderCall(
    request: LlmChatRequest,
    provider: LlmProviderAdapter,
    messages: LlmMessage[],
    effectiveDataClass: DataClass,
    providerAlias: 'primary' | 'fallback',
  ) {
    const timeoutMs = this.getPositiveInteger(
      providerAlias === 'fallback'
        ? process.env.LLM_FALLBACK_PROVIDER_TIMEOUT_MS
        : process.env.LLM_PROVIDER_TIMEOUT_MS,
      providerAlias === 'fallback'
        ? DEFAULT_FALLBACK_PROVIDER_TIMEOUT_MS
        : DEFAULT_PROVIDER_TIMEOUT_MS,
    );
    const maxAttempts = this.getPositiveInteger(
      providerAlias === 'fallback'
        ? process.env.LLM_FALLBACK_PROVIDER_MAX_ATTEMPTS
        : process.env.LLM_PROVIDER_MAX_ATTEMPTS,
      providerAlias === 'fallback'
        ? DEFAULT_FALLBACK_PROVIDER_MAX_ATTEMPTS
        : DEFAULT_PROVIDER_MAX_ATTEMPTS,
    );
    const backoffBaseMs = this.getPositiveInteger(
      providerAlias === 'fallback'
        ? process.env.LLM_FALLBACK_PROVIDER_BACKOFF_BASE_MS
        : process.env.LLM_PROVIDER_BACKOFF_BASE_MS,
      providerAlias === 'fallback'
        ? DEFAULT_FALLBACK_PROVIDER_BACKOFF_BASE_MS
        : DEFAULT_PROVIDER_BACKOFF_BASE_MS,
    );
    const backoffMaxMs = this.getPositiveInteger(
      providerAlias === 'fallback'
        ? process.env.LLM_FALLBACK_PROVIDER_BACKOFF_MAX_MS
        : process.env.LLM_PROVIDER_BACKOFF_MAX_MS,
      providerAlias === 'fallback'
        ? DEFAULT_FALLBACK_PROVIDER_BACKOFF_MAX_MS
        : DEFAULT_PROVIDER_BACKOFF_MAX_MS,
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
            modelAlias: provider.modelId,
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

  private assertFallbackConfig(): void {
    if (process.env.LLM_FALLBACK_ENABLED !== 'true') {
      return;
    }

    const hasRequiredValue = (value: string | undefined) =>
      Boolean(value?.trim());
    const hasRequiredOpenAiCompatibleConfig =
      hasRequiredValue(process.env.LLM_FALLBACK_OPENAI_COMPATIBLE_BASE_URL) &&
      hasRequiredValue(process.env.LLM_FALLBACK_OPENAI_COMPATIBLE_API_KEY) &&
      hasRequiredValue(process.env.LLM_FALLBACK_OPENAI_COMPATIBLE_CHAT_MODEL);

    if (
      process.env.LLM_FALLBACK_PROVIDER !== LlmProvider.OpenAICompatible ||
      !hasRequiredValue(process.env.LLM_FALLBACK_MODEL_ALIAS) ||
      !hasRequiredOpenAiCompatibleConfig
    ) {
      throw new AiError(
        'AI_PROVIDER_CONFIG_INVALID',
        'provider_config_invalid',
        {
          retryable: false,
          fallbackEligible: false,
        },
      );
    }
  }

  private assertProviderResponsePolicy(
    content: string,
    mode: AnonymizationMode,
  ): void {
    if (mode === AnonymizationMode.Disabled) {
      return;
    }

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
    const error = new BadRequestException(
      VALIDATION_ERROR,
    ) as BadRequestException & SafeException;
    error.safeErrorCode = 'AI_VALIDATION_FAILED';
    return error;
  }

  private safeRestoreError(): BadRequestException {
    const error = new BadRequestException(
      RESTORE_ERROR,
    ) as BadRequestException & SafeException;
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

  private safeProviderConfigError(): ServiceUnavailableException {
    const error = new ServiceUnavailableException(
      PROVIDER_CONFIG_ERROR,
    ) as ServiceUnavailableException & SafeException;
    error.safeErrorCode = 'AI_PROVIDER_CONFIG_INVALID';
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
    if (
      error instanceof BadRequestException ||
      error instanceof ForbiddenException
    ) {
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
        error.code === 'AI_PROVIDER_CONFIG_INVALID' ||
        error.code === 'AI_PROVIDER_UNAVAILABLE' ||
        error.code === 'AI_PROVIDER_RATE_LIMITED' ||
        error.code === 'AI_PROVIDER_HTTP_5XX' ||
        error.code === 'AI_PROVIDER_RETRY_EXHAUSTED' ||
        error.code === 'AI_FALLBACK_NOT_AVAILABLE'
      ) {
        return error.code === 'AI_PROVIDER_CONFIG_INVALID'
          ? this.safeProviderConfigError()
          : this.safeProviderUnavailableError(error.code);
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

      if (
        error.code === 'AI_STREAM_UNSUPPORTED' ||
        error.code === 'AI_STREAM_EMPTY'
      ) {
        return this.safeProviderUnavailableError(error.code);
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

  private buildCachePayload(
    request: LlmChatRequest,
    provider: LlmProviderAdapter,
    messages: LlmMessage[],
    effectiveDataClass: DataClass,
    providerAlias: 'primary' | 'fallback',
  ): Record<string, unknown> {
    return {
      agentId: request.agentId,
      task: request.task,
      providerAlias,
      providerId: provider.providerId,
      modelId: provider.modelId,
      effectiveDataClass,
      messages,
    };
  }

  private isCacheEligible(
    request: LlmChatRequest,
    declaredDataClass: DataClass | undefined,
    effectiveDataClass: DataClass,
    anonymizationMode: AnonymizationMode,
    anonymizationResult: AnonymizationResult | undefined,
  ): boolean {
    if (
      anonymizationMode === AnonymizationMode.Disabled &&
      this.piiAnonymizer.scanMessages(request.messages).hasPii
    ) {
      return false;
    }

    return (
      typeof request.policy?.cacheTtlMs === 'number' &&
      Number.isFinite(request.policy.cacheTtlMs) &&
      request.policy.cacheTtlMs > 0 &&
      declaredDataClass === DataClass.NoPii &&
      effectiveDataClass === DataClass.NoPii &&
      !anonymizationResult
    );
  }

  private writeSafeCachedResponse(
    cacheKey: string | undefined,
    cacheHit: boolean | undefined,
    response: LlmChatResponse,
    ttlMs: number | undefined,
    anonymizationMode: AnonymizationMode,
  ): void {
    if (!this.aiCache || !cacheKey || cacheHit) {
      return;
    }

    if (
      anonymizationMode === AnonymizationMode.Disabled &&
      this.piiAnonymizer.scanText(response.content).hasPii
    ) {
      return;
    }

    const cacheable = { ...response };
    delete cacheable.cacheKey;
    delete cacheable.cacheHit;
    this.aiCache.write(cacheKey, cacheable, ttlMs);
  }

  private logFlowSucceeded(options: {
    request: LlmChatRequest;
    response: LlmChatResponse;
    fallbackUsed: boolean;
    fallbackReasonCode?: SafeLlmErrorCode;
    anonymizationStats?: Record<string, number>;
    startedAt: number;
  }): void {
    this.monitoring.log({
      eventName: AiMonitoringEventName.AiFlowSucceeded,
      operation: AiMonitoringOperation.LlmChat,
      stage: AiMonitoringStage.AiFlow,
      status: AiMonitoringStatus.Success,
      providerAlias: options.fallbackUsed ? 'fallback' : 'primary',
      modelAlias: options.response.modelId,
      providerConfigured: true,
      task: options.request.task,
      dataClass: options.response.dataClass,
      effectiveDataClass: options.response.dataClass,
      tokensIn: options.response.usage.tokensIn,
      tokensOut: options.response.usage.tokensOut,
      costRub: options.response.usage.costRub,
      latencyMs: Date.now() - options.startedAt,
      anonymizationStats: options.anonymizationStats,
      fallbackUsed: options.fallbackUsed,
      fallbackReasonCode: options.fallbackReasonCode,
    });
  }

  private safeFallbackModelAlias(): string | undefined {
    const value = process.env.LLM_FALLBACK_MODEL_ALIAS?.trim();
    return value || undefined;
  }

  private parseCsv(value: string | undefined): string[] {
    return (value ?? '')
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);
  }

  private getPositiveInteger(
    value: string | undefined,
    fallback: number,
  ): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return fallback;
    }

    return parsed;
  }

  /**
   * Streams an LLM chat response through the same anonymization, policy and
   * monitoring pipeline as `chat`, yielding `delta` events as content arrives
   * and a terminal `done` event carrying the fully-restored `LlmChatResponse`.
   *
   * Streaming does NOT participate in the shared cache — `stream_options.include_usage`
   * gives us real usage counters at the tail, but every stream still costs a
   * fresh provider call. Cache write on stream would leak partial content into
   * the cached record on abort mid-stream.
   *
   * When anonymization rewrote the outgoing messages, we cannot safely emit
   * upstream deltas as-is (a placeholder like `{{PII_PHONE_0001}}` could arrive
   * split across two chunks and leak the raw fragment client-side). In that
   * case we throw `AI_STREAM_UNSUPPORTED`; the caller can fall back to the
   * regular `chat` method.
   */
  async *chatStream(
    request: LlmChatRequest,
    signal?: AbortSignal,
  ): AsyncGenerator<LlmChatStreamEvent, void, void> {
    const flowStartedAt = Date.now();
    let currentStage = AiMonitoringStage.Validation;
    let task: LlmTask | undefined;
    let effectiveDataClass: DataClass | undefined;
    let anonymizationStats: Record<string, number> | undefined;
    let provider: LlmProviderAdapter | undefined;

    try {
      this.validateRequest(request);
      task = request.task;

      const declaredDataClass = this.resolveDeclaredDataClass(request);
      const anonymizationMode = this.getAnonymizationMode();
      provider = this.selectProvider(request, 'primary');
      if (typeof provider.streamChat !== 'function') {
        throw this.safeStreamUnsupportedError();
      }

      currentStage = AiMonitoringStage.Anonymization;
      const anonymizationResult = await this.resolveAnonymization(
        request.messages,
        declaredDataClass,
        anonymizationMode,
      );
      if (anonymizationResult) {
        // See method jsdoc — streaming with placeholder-restore is not safe.
        throw this.safeStreamUnsupportedError();
      }

      const providerMessages = this.buildProviderMessages(
        request.messages,
        undefined,
      );

      effectiveDataClass = this.resolveUnanonymizedDataClass(
        request.messages,
        declaredDataClass,
        anonymizationMode,
      );
      anonymizationStats = undefined;

      this.assertProviderPolicy(
        effectiveDataClass,
        provider,
        anonymizationMode,
      );

      currentStage = AiMonitoringStage.ProviderCall;
      const startedAt = Date.now();
      let accumulated = '';
      let usage = {
        tokensIn: 0,
        tokensOut: 0,
        costRub: 0,
        latencyMs: 0,
      };
      let sawContent = false;
      // The PII scanner must catch a pattern that straddles two deltas but
      // it does not need to rescan the entire response on every chunk. Keep
      // a sliding window equal to the longest recognised placeholder plus
      // the new delta so worst-case work stays O(window) per event.
      const piiWindowSize = 64;
      let piiScanCursor = 0;

      const stream = provider.streamChat(providerMessages, { signal });
      for await (const event of stream as AsyncIterable<LlmProviderStreamEvent>) {
        if (event.type === 'delta') {
          if (!event.content) continue;
          accumulated += event.content;
          const scanFrom = Math.max(0, piiScanCursor - piiWindowSize);
          this.assertProviderResponsePolicy(
            accumulated.slice(scanFrom),
            anonymizationMode,
          );
          piiScanCursor = accumulated.length;
          sawContent = true;
          yield { type: 'delta', content: event.content };
          continue;
        }
        // done
        usage = {
          tokensIn: event.usage.tokensIn,
          tokensOut: event.usage.tokensOut,
          costRub: event.usage.costRub ?? 0,
          latencyMs: event.usage.latencyMs || Date.now() - startedAt,
        };
      }

      if (!sawContent) {
        throw new AiError('AI_STREAM_EMPTY', 'stream_empty', {
          retryable: false,
          fallbackEligible: false,
        });
      }

      currentStage = AiMonitoringStage.SafetyScan;
      this.assertProviderResponsePolicy(accumulated, anonymizationMode);

      currentStage = AiMonitoringStage.Restore;
      const restoredContent = this.restoreProviderResponse(
        accumulated,
        undefined,
      );

      const response: LlmChatResponse = {
        providerId: provider.providerId,
        modelId: provider.modelId,
        content: restoredContent,
        usage,
        dataClass: effectiveDataClass,
        anonymizationStats,
      };

      this.monitoring.log({
        eventName: AiMonitoringEventName.AiFlowSucceeded,
        operation: AiMonitoringOperation.LlmChatStream,
        stage: AiMonitoringStage.AiFlow,
        status: AiMonitoringStatus.Success,
        providerAlias: 'primary',
        modelAlias: provider.modelId,
        providerConfigured: true,
        task,
        dataClass: effectiveDataClass,
        effectiveDataClass,
        tokensIn: usage.tokensIn,
        tokensOut: usage.tokensOut,
        costRub: usage.costRub,
        latencyMs: Date.now() - flowStartedAt,
        anonymizationStats,
        fallbackUsed: false,
      });

      yield { type: 'done', response };
    } catch (error) {
      const safeError = this.toSafeException(error);
      const errorCode = this.getErrorCode(safeError);
      this.monitoring.log({
        eventName: AiMonitoringEventName.AiStageFailed,
        operation: AiMonitoringOperation.LlmChatStream,
        stage: currentStage,
        status: AiMonitoringStatus.Failure,
        task,
        dataClass: effectiveDataClass ?? 'unresolved',
        effectiveDataClass: effectiveDataClass ?? 'unresolved',
        errorCode,
        latencyMs: Date.now() - flowStartedAt,
        anonymizationStats,
        fallbackUsed: false,
        providerConfigured: Boolean(provider),
      });
      this.monitoring.log({
        eventName: AiMonitoringEventName.AiFlowFailed,
        operation: AiMonitoringOperation.LlmChatStream,
        stage: AiMonitoringStage.AiFlow,
        status: AiMonitoringStatus.Failure,
        task,
        dataClass: effectiveDataClass ?? 'unresolved',
        effectiveDataClass: effectiveDataClass ?? 'unresolved',
        errorCode,
        latencyMs: Date.now() - flowStartedAt,
        anonymizationStats,
        fallbackUsed: false,
        providerConfigured: Boolean(provider),
      });
      throw safeError;
    }
  }

  private safeStreamUnsupportedError(): ServiceUnavailableException {
    const error = new ServiceUnavailableException(
      'LLM provider does not support streaming',
    ) as ServiceUnavailableException & SafeException;
    error.safeErrorCode = 'AI_STREAM_UNSUPPORTED';
    return error;
  }
}
