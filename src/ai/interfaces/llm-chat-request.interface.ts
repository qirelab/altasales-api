import { AgentId } from '../enums/agent-id.enum';
import { DataClass } from '../enums/data-class.enum';
import { LlmProvider } from '../enums/llm-provider.enum';
import { LlmTask } from '../enums/llm-task.enum';
import { LlmMessage } from './llm-message.interface';

export interface LlmChatRequest {
  agentId: AgentId;
  task: LlmTask;
  messages: LlmMessage[];
  declaredDataClass?: DataClass;
  policy?: {
    providers?: LlmProvider[];
  };
}
