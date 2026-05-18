import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { AiMonitoringService } from './ai-monitoring.service';
import { AiError, isAiError } from './errors/ai-error';
import { AiMonitoringEventName } from './enums/ai-monitoring-event-name.enum';
import { AiMonitoringOperation } from './enums/ai-monitoring-operation.enum';
import { AiMonitoringStage } from './enums/ai-monitoring-stage.enum';
import { AiMonitoringStatus } from './enums/ai-monitoring-status.enum';
import { DataClass } from './enums/data-class.enum';
import { LlmProvider } from './enums/llm-provider.enum';
import { EmbeddingProviderAdapter } from './interfaces/embedding-provider-adapter.interface';
import { EmbeddingRequest } from './interfaces/embedding-request.interface';
import { EmbeddingResponse } from './interfaces/embedding-response.interface';
import { SafeLlmErrorCode } from './interfaces/safe-llm-log.interface';
import {
  EMBEDDING_PROVIDER_ADAPTERS,
} from './providers/embedding-provider-registry';
import type { EmbeddingProviderRegistry } from './providers/embedding-provider-registry';
import { OpenAICompatibleEmbeddingProviderAdapter } from './providers/openai-compatible-embedding.provider';
import { executeWithResilience } from './resilience/llm-resilience';

const DEFAULT_EMBEDDING_TIMEOUT_MS = 10_000;
const DEFAULT_EMBEDDING_MAX_ATTEMPTS = 2;
const DEFAULT_EMBEDDING_BACKOFF_BASE_MS = 200;
const DEFAULT_EMBEDDING_BACKOFF_MAX_MS = 2_000;
const DEFAULT_EMBEDDING_MODEL_ALIAS = 'embedding-default';
const MAX_EMBEDDING_INPUTS = 128;

type SafeException = Error & {
  safeErrorCode?: SafeLlmErrorCode;
};

@Injectable()
export class EmbeddingProxyService {
  constructor(
    private readonly monitoring: AiMonitoringService,
    private readonly openAICompatibleEmbeddingProvider: OpenAICompatibleEmbeddingProviderAdapter,
    @Optional()
    @Inject(EMBEDDING_PROVIDER_ADAPTERS)
    private readonly providerRegistry?: EmbeddingProviderRegistry,
  ) {}

  async embed(request: EmbeddingRequest): Promise<EmbeddingResponse> {
    const startedAt = Date.now();
    let currentStage = AiMonitoringStage.Validation;
    let provider: EmbeddingProviderAdapter | undefined;
    const inputCount = Array.isArray(request?.inputs)
      ? request.inputs.length
      : undefined;
    const dataClass = request?.declaredDataClass ?? DataClass.Unknown;

    try {
      this.validateRequest(request);
      provider = this.selectProvider(request);
      this.assertEmbeddingPolicy(dataClass, provider);

      currentStage = AiMonitoringStage.ProviderCall;
      const providerResponse = await this.callProvider(
        provider,
        request.inputs,
        dataClass,
      );

      this.monitoring.log({
        eventName: AiMonitoringEventName.AiStageSucceeded,
        operation: AiMonitoringOperation.Embedding,
        stage: AiMonitoringStage.ProviderCall,
        status: AiMonitoringStatus.Success,
        providerAlias: 'primary',
        modelAlias: 'default',
        providerConfigured: true,
        dataClass,
        latencyMs: Date.now() - startedAt,
        inputCount,
        vectorDimensions: providerResponse.dimensions,
        tokensIn: providerResponse.usage.tokensIn,
        tokensOut: providerResponse.usage.tokensOut,
        costRub: providerResponse.usage.costRub,
      });

      return {
        providerId: provider.providerId,
        modelId: provider.modelId,
        vectors: providerResponse.vectors,
        usage: providerResponse.usage,
        dimensions: providerResponse.dimensions,
        dataClass,
      };
    } catch (error) {
      const safeError = this.toSafeException(error);
      this.monitoring.log({
        eventName: AiMonitoringEventName.AiStageFailed,
        operation: AiMonitoringOperation.Embedding,
        stage: currentStage,
        status: AiMonitoringStatus.Failure,
        providerAlias: provider ? 'primary' : undefined,
        modelAlias: provider ? 'default' : undefined,
        providerConfigured: Boolean(provider),
        dataClass,
        errorCode: this.getErrorCode(safeError),
        latencyMs: Date.now() - startedAt,
        inputCount,
      });
      throw safeError;
    }
  }

  private validateRequest(request: EmbeddingRequest): void {
    const hasValidInputs =
      Array.isArray(request?.inputs) &&
      request.inputs.length > 0 &&
      request.inputs.length <= MAX_EMBEDDING_INPUTS &&
      request.inputs.every(
        (input) => typeof input === 'string' && input.trim().length > 0,
      );
    const hasValidDataClass =
      !request?.declaredDataClass ||
      Object.values(DataClass).includes(request.declaredDataClass);

    if (!hasValidInputs || !hasValidDataClass) {
      throw this.safeValidationError();
    }
  }

  private selectProvider(request: EmbeddingRequest): EmbeddingProviderAdapter {
    const providerId =
      process.env.LLM_EMBEDDING_PROVIDER || LlmProvider.OpenAICompatible;
    const modelId =
      process.env.LLM_EMBEDDING_MODEL_ALIAS || DEFAULT_EMBEDDING_MODEL_ALIAS;
    const provider = this.findProvider(providerId, modelId);
    this.assertProviderAndModelAllowed(provider, request);
    return provider;
  }

  private findProvider(
    providerId: string,
    modelId: string,
  ): EmbeddingProviderAdapter {
    const providers = this.getRegisteredProviders();
    const provider = providers.find(
      (candidate) =>
        candidate.providerId === providerId && candidate.modelId === modelId,
    );
    if (provider) {
      return provider;
    }

    throw this.safePolicyError('AI_PROVIDER_NOT_ALLOWED');
  }

  private getRegisteredProviders(): EmbeddingProviderAdapter[] {
    if (this.providerRegistry?.length) {
      return this.providerRegistry;
    }

    return [this.openAICompatibleEmbeddingProvider];
  }

  private assertProviderAndModelAllowed(
    provider: EmbeddingProviderAdapter,
    request: EmbeddingRequest,
  ): void {
    if (
      request.policy?.providers &&
      !request.policy.providers.includes(provider.providerId)
    ) {
      throw this.safePolicyError('AI_PROVIDER_NOT_ALLOWED');
    }

    const allowedProviders = this.parseCsv(process.env.LLM_ALLOWED_PROVIDERS);
    if (
      allowedProviders.length > 0 &&
      !allowedProviders.includes(provider.providerId)
    ) {
      throw this.safePolicyError('AI_PROVIDER_NOT_ALLOWED');
    }

    const allowedModels = this.parseCsv(process.env.LLM_ALLOWED_MODEL_ALIASES);
    if (allowedModels.length > 0 && !allowedModels.includes(provider.modelId)) {
      throw this.safePolicyError('AI_MODEL_NOT_ALLOWED');
    }
  }

  private assertEmbeddingPolicy(
    dataClass: DataClass,
    provider: EmbeddingProviderAdapter,
  ): void {
    if (dataClass === DataClass.Unknown) {
      throw this.safePolicyError('AI_EMBEDDING_POLICY_BLOCKED');
    }

    if (
      provider.isExternal !== false &&
      (dataClass === DataClass.RawPii || dataClass === DataClass.HighSensitive)
    ) {
      throw this.safePolicyError('AI_EMBEDDING_POLICY_BLOCKED');
    }
  }

  private async callProvider(
    provider: EmbeddingProviderAdapter,
    inputs: string[],
    dataClass: DataClass,
  ) {
    const timeoutMs = this.getPositiveInteger(
      process.env.LLM_EMBEDDING_TIMEOUT_MS,
      DEFAULT_EMBEDDING_TIMEOUT_MS,
    );
    const maxAttempts = this.getPositiveInteger(
      process.env.LLM_EMBEDDING_MAX_ATTEMPTS,
      DEFAULT_EMBEDDING_MAX_ATTEMPTS,
    );
    const backoffBaseMs = this.getPositiveInteger(
      process.env.LLM_EMBEDDING_BACKOFF_BASE_MS,
      DEFAULT_EMBEDDING_BACKOFF_BASE_MS,
    );
    const backoffMaxMs = this.getPositiveInteger(
      process.env.LLM_EMBEDDING_BACKOFF_MAX_MS,
      DEFAULT_EMBEDDING_BACKOFF_MAX_MS,
    );

    return executeWithResilience((signal) => provider.embed(inputs, { signal }), {
      timeoutMs,
      maxAttempts,
      backoffBaseMs,
      backoffMaxMs,
      onAttemptFailure: ({ attempt, maxAttempts, error, latencyMs }) =>
        this.monitoring.log({
          eventName: AiMonitoringEventName.AiRetryAttemptFailed,
          operation: AiMonitoringOperation.Embedding,
          stage: AiMonitoringStage.Retry,
          status: AiMonitoringStatus.Failure,
          providerAlias: 'primary',
          modelAlias: 'default',
          providerConfigured: true,
          dataClass,
          errorCode: error.code,
          attempt,
          maxAttempts,
          latencyMs,
          inputCount: inputs.length,
        }),
    });
  }

  private toSafeException(error: unknown): Error {
    if (error instanceof BadRequestException || error instanceof ForbiddenException) {
      return error;
    }

    if (error instanceof ServiceUnavailableException) {
      return error;
    }

    if (isAiError(error)) {
      if (
        error.code === 'AI_EMBEDDING_VALIDATION_FAILED' ||
        error.code === 'AI_EMBEDDING_RESPONSE_INVALID'
      ) {
        return this.safeValidationError(error.code);
      }

      if (
        error.code === 'AI_EMBEDDING_POLICY_BLOCKED' ||
        error.code === 'AI_PROVIDER_NOT_ALLOWED' ||
        error.code === 'AI_MODEL_NOT_ALLOWED'
      ) {
        return this.safePolicyError(error.code);
      }
    }

    return this.safeProviderUnavailableError(this.getErrorCode(error));
  }

  private getErrorCode(error: unknown): SafeLlmErrorCode {
    if (isAiError(error)) {
      return error.code;
    }

    const safeError = error as SafeException;
    if (safeError?.safeErrorCode) {
      return safeError.safeErrorCode;
    }

    if (error instanceof BadRequestException) {
      return 'AI_EMBEDDING_VALIDATION_FAILED';
    }
    if (error instanceof ForbiddenException) {
      return 'AI_EMBEDDING_POLICY_BLOCKED';
    }
    return 'AI_EMBEDDING_PROVIDER_UNAVAILABLE';
  }

  private safeValidationError(
    code: SafeLlmErrorCode = 'AI_EMBEDDING_VALIDATION_FAILED',
  ): BadRequestException {
    const error = new BadRequestException(
      'Embedding request validation failed',
    ) as BadRequestException & SafeException;
    error.safeErrorCode = code;
    return error;
  }

  private safePolicyError(code: SafeLlmErrorCode): ForbiddenException {
    const error = new ForbiddenException(
      'Embedding request blocked by data policy',
    ) as ForbiddenException & SafeException;
    error.safeErrorCode = code;
    return error;
  }

  private safeProviderUnavailableError(
    code: SafeLlmErrorCode,
  ): ServiceUnavailableException {
    const error = new ServiceUnavailableException(
      'Embedding provider is unavailable',
    ) as ServiceUnavailableException & SafeException;
    error.safeErrorCode = code;
    return error;
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
