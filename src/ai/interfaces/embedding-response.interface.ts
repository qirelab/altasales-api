import { DataClass } from '../enums/data-class.enum';
import { LlmUsage } from './llm-usage.interface';

export interface EmbeddingResponse {
  providerId: string;
  modelId: string;
  vectors: number[][];
  usage: LlmUsage;
  dimensions: number;
  dataClass: DataClass;
  cacheKey?: string;
  cacheHit?: boolean;
}
