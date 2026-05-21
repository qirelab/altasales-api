import { DataClass } from '../enums/data-class.enum';
import { LlmMessage } from './llm-message.interface';

export type PiiEntityType =
  | 'person'
  | 'phone'
  | 'email'
  | 'inn'
  | 'snils'
  | 'passport'
  | 'bank_card'
  | 'birth_date';

export interface DetectedPiiEntity {
  placeholder: string;
  type: PiiEntityType;
  description: string;
}

export type PlaceholderMap = Record<string, string>;

export type SemanticPlaceholderDescriptions = Record<string, string>;

export interface AnonymizationResult {
  messages: LlmMessage[];
  entities: DetectedPiiEntity[];
  placeholderMap: PlaceholderMap;
  semanticPlaceholderDescriptions: SemanticPlaceholderDescriptions;
  stats: Record<string, number>;
  dataClass: DataClass;
}

export interface RestoreResult {
  content: string;
  restoredCount: number;
  unresolvedPlaceholders: string[];
}
