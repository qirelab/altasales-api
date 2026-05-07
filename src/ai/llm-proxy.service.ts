import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { AgentId } from './enums/agent-id.enum';
import { DataClass } from './enums/data-class.enum';
import { LlmProvider } from './enums/llm-provider.enum';
import { LlmTask } from './enums/llm-task.enum';
import { LlmChatRequest } from './interfaces/llm-chat-request.interface';
import { LlmChatResponse } from './interfaces/llm-chat-response.interface';
import { LlmMessage } from './interfaces/llm-message.interface';
import { LlmProviderAdapter } from './interfaces/llm-provider-adapter.interface';
import { PiiAnonymizerService } from './pii-anonymizer.service';
import { MockLlmProvider } from './providers/mock-llm.provider';

const VALIDATION_ERROR = 'LLM request validation failed';
const POLICY_ERROR = 'LLM request blocked by data policy';
const PROVIDER_POLICY_ERROR = 'LLM provider is not allowed by policy';

@Injectable()
export class LlmProxyService {
  private readonly logger = new Logger(LlmProxyService.name);

  constructor(
    private readonly piiAnonymizer: PiiAnonymizerService,
    private readonly mockProvider: MockLlmProvider,
  ) {}

  async chat(request: LlmChatRequest): Promise<LlmChatResponse> {
    this.validateRequest(request);

    let dataClass: DataClass | undefined;

    try {
      dataClass = this.resolveDataClass(request);
      this.assertDataPolicy(dataClass);

      const provider = this.selectProvider(request);
      const providerResponse = await provider.chat(request.messages);

      this.assertProviderResponsePolicy(providerResponse.content);

      const response: LlmChatResponse = {
        providerId: provider.providerId,
        modelId: provider.modelId,
        content: providerResponse.content,
        usage: providerResponse.usage,
        dataClass,
      };

      this.logSafe({
        agentId: request.agentId,
        providerId: response.providerId,
        modelId: response.modelId,
        task: request.task,
        dataClass: response.dataClass,
        tokensIn: response.usage.tokensIn,
        tokensOut: response.usage.tokensOut,
        costRub: response.usage.costRub,
        latencyMs: response.usage.latencyMs,
        status: 'success',
      });

      return response;
    } catch (error) {
      this.logSafe({
        agentId: request.agentId,
        task: request.task,
        dataClass: dataClass ?? request.dataClass ?? 'unresolved',
        status: 'blocked',
        errorCode: this.getErrorCode(error),
      });
      throw error;
    }
  }

  private validateRequest(request: LlmChatRequest): void {
    const hasValidAgent = Object.values(AgentId).includes(request?.agentId);
    const hasValidTask = Object.values(LlmTask).includes(request?.task);
    const hasValidDataClass =
      !request?.dataClass ||
      Object.values(DataClass).includes(request.dataClass);
    const hasMessages =
      Array.isArray(request?.messages) && request.messages.length > 0;
    const hasValidMessages =
      hasMessages &&
      request.messages.every((message) => this.isValidMessage(message));

    if (
      !hasValidAgent ||
      !hasValidTask ||
      !hasValidDataClass ||
      !hasValidMessages
    ) {
      throw new BadRequestException(VALIDATION_ERROR);
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

  private resolveDataClass(request: LlmChatRequest): DataClass {
    const scan = this.piiAnonymizer.scanMessages(request.messages);

    if (scan.hasPii) {
      throw new ForbiddenException(POLICY_ERROR);
    }

    return request.dataClass ?? DataClass.NoPii;
  }

  private assertDataPolicy(dataClass: DataClass): void {
    // Raw personal data is blocked before provider calls.
    if (
      dataClass === DataClass.Unknown ||
      dataClass === DataClass.HighSensitive ||
      dataClass === DataClass.RawPii
    ) {
      throw new ForbiddenException(POLICY_ERROR);
    }
  }

  private selectProvider(request: LlmChatRequest): LlmProviderAdapter {
    const allowedProviders = request.policy?.providers;
    if (allowedProviders && !allowedProviders.includes(LlmProvider.Mock)) {
      throw new ForbiddenException(PROVIDER_POLICY_ERROR);
    }

    return this.mockProvider;
  }

  private assertProviderResponsePolicy(content: string): void {
    const scan = this.piiAnonymizer.scanText(content);
    if (scan.hasPii) {
      throw new ForbiddenException(POLICY_ERROR);
    }
  }

  private getErrorCode(error: unknown): string {
    if (error instanceof BadRequestException) return 'validation_failed';
    if (error instanceof ForbiddenException) return 'policy_blocked';
    return 'provider_error';
  }

  private logSafe(metadata: Record<string, unknown>): void {
    this.logger.log(metadata);
  }
}
