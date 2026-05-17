import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { AgentId } from './enums/agent-id.enum';
import { AnonymizationMode } from './enums/anonymization-mode.enum';
import { DataClass } from './enums/data-class.enum';
import { LlmProvider } from './enums/llm-provider.enum';
import { LlmTask } from './enums/llm-task.enum';
import { LlmChatRequest } from './interfaces/llm-chat-request.interface';
import { LlmChatResponse } from './interfaces/llm-chat-response.interface';
import { LlmMessage } from './interfaces/llm-message.interface';
import { LlmProviderAdapter } from './interfaces/llm-provider-adapter.interface';
import { AnonymizationResult } from './interfaces/pii-anonymization.interface';
import {
  SafeLlmErrorCode,
  SafeLlmLogMetadata,
  SafeLlmStatus,
} from './interfaces/safe-llm-log.interface';
import { PiiAnonymizerService } from './pii-anonymizer.service';
import { MockLlmProvider } from './providers/mock-llm.provider';

const VALIDATION_ERROR = 'LLM request validation failed';
const POLICY_ERROR = 'LLM request blocked by data policy';
const PROVIDER_POLICY_ERROR = 'LLM provider is not allowed by policy';
const PLACEHOLDER_GUIDANCE =
  'PII placeholders are intentional anonymization tokens. Do not modify, decline, delete, replace, or inflect placeholders. Use neutral constructions where possible, for example "contact person: {{PII_PERSON_0001}}" or "email: {{PII_EMAIL_0001}}".';

type SafeException = Error & {
  safeErrorCode?: SafeLlmErrorCode;
};

@Injectable()
export class LlmProxyService {
  private readonly logger = new Logger(LlmProxyService.name);

  constructor(
    private readonly piiAnonymizer: PiiAnonymizerService,
    private readonly mockProvider: MockLlmProvider,
  ) {}

  async chat(request: LlmChatRequest): Promise<LlmChatResponse> {
    this.validateRequest(request);

    let effectiveDataClass: DataClass | undefined;
    let anonymizationStats: Record<string, number> | undefined;
    let provider: LlmProviderAdapter | undefined;

    try {
      const declaredDataClass = this.resolveDeclaredDataClass(request);
      const anonymizationMode = this.getAnonymizationMode();
      provider = this.selectProvider(request);

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

      const providerResponse = await this.callProvider(provider, providerMessages);
      this.assertProviderResponsePolicy(providerResponse.content);

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

      this.logSafe({
        agentId: request.agentId,
        providerId: response.providerId,
        modelId: response.modelId,
        task: request.task,
        effectiveDataClass: response.dataClass,
        tokensIn: response.usage.tokensIn,
        tokensOut: response.usage.tokensOut,
        costRub: response.usage.costRub,
        latencyMs: response.usage.latencyMs,
        status: 'success',
        anonymizationStats,
      });

      return response;
    } catch (error) {
      const errorCode = this.getErrorCode(error);
      this.logSafe({
        agentId: request.agentId,
        task: request.task,
        providerId: provider?.providerId,
        modelId: provider?.modelId,
        effectiveDataClass: effectiveDataClass ?? 'unresolved',
        status: this.getStatus(errorCode),
        errorCode,
        anonymizationStats,
      });
      throw error;
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

  private selectProvider(request: LlmChatRequest): LlmProviderAdapter {
    const allowedProviders = request.policy?.providers;
    if (allowedProviders && !allowedProviders.includes(LlmProvider.Mock)) {
      throw this.safePolicyError('policy_blocked', PROVIDER_POLICY_ERROR);
    }

    return this.mockProvider;
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

  private async callProvider(
    provider: LlmProviderAdapter,
    messages: LlmMessage[],
  ) {
    try {
      return await provider.chat(messages);
    } catch {
      throw this.safeProviderError();
    }
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
      throw this.safeValidationError();
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
    error.safeErrorCode = 'validation_failed';
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

  private safeProviderError(): ForbiddenException {
    const error = new ForbiddenException(POLICY_ERROR) as ForbiddenException &
      SafeException;
    error.safeErrorCode = 'provider_error';
    return error;
  }

  private getErrorCode(error: unknown): SafeLlmErrorCode {
    const safeError = error as SafeException;
    if (safeError?.safeErrorCode) {
      return safeError.safeErrorCode;
    }

    if (error instanceof BadRequestException) return 'validation_failed';
    if (error instanceof ForbiddenException) return 'policy_blocked';
    return 'provider_error';
  }

  private getStatus(errorCode: SafeLlmErrorCode): SafeLlmStatus {
    if (errorCode === 'validation_failed') return 'validation_error';
    if (errorCode === 'provider_error') return 'provider_error';
    if (errorCode === 'anonymizer_error') return 'anonymizer_error';
    return 'blocked';
  }

  private logSafe(metadata: SafeLlmLogMetadata): void {
    this.logger.log(metadata);
  }
}
