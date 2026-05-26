import { DataClass } from '../enums/data-class.enum';
import { LlmUsage } from './llm-usage.interface';

export interface LlmChatResponse {
  providerId: string;
  modelId: string;
  content: string;
  usage: LlmUsage;
  dataClass: DataClass;
  cacheKey?: string;
  cacheHit?: boolean;
}
