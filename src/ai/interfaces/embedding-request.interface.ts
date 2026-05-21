import { DataClass } from '../enums/data-class.enum';

export interface EmbeddingRequest {
  inputs: string[];
  declaredDataClass?: DataClass;
  policy?: {
    providers?: string[];
  };
}
