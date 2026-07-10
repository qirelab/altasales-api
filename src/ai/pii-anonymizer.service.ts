import { Inject, Injectable, Optional } from '@nestjs/common';
import { DataClass } from './enums/data-class.enum';
import {
  AnonymizationResult,
  DetectedPiiEntity,
  PiiEntityType,
  PlaceholderMap,
  RestoreResult,
  SemanticPlaceholderDescriptions,
} from './interfaces/pii-anonymization.interface';
import { LlmMessage } from './interfaces/llm-message.interface';
import type { AnonymizerProvider } from './interfaces/anonymizer-provider.interface';
import { PiiScanResult } from './interfaces/pii-scan-result.interface';
import { AnonymizerLlmProvider } from './providers/anonymizer-llm.provider';

type PiiKind =
  | 'email'
  | 'phone'
  | 'inn'
  | 'snils'
  | 'passport'
  | 'bank_card'
  | 'birth_date';

const SUPPORTED_ENTITY_TYPES: readonly PiiEntityType[] = [
  'person',
  'phone',
  'email',
  'inn',
  'snils',
  'passport',
  'address',
  'bank_card',
  'birth_date',
];

const HIGH_SENSITIVE_ENTITY_TYPES = new Set<PiiEntityType>([
  'snils',
  'passport',
  'bank_card',
]);

const PII_PATTERNS: Record<Exclude<PiiKind, 'bank_card'>, RegExp> = {
  email: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
  phone: /(?:\+7|8)\s*(?:\(\d{3}\)|\d{3})[\s-]*\d{3}[\s-]*\d{2}[\s-]*\d{2}/g,
  inn: /\b\d{10}(?:\d{2})?\b/g,
  snils: /\b\d{3}-\d{3}-\d{3}\s?\d{2}\b/g,
  passport: /(?:passport|паспорт)\D{0,20}\b\d{2}\s?\d{2}\s?\d{6}\b/giu,
  birth_date:
    /(?:birth(?:\s+date)?|date\s+of\s+birth|дата\s+рождения|родил[асься]*|рождени[ея]).{0,40}\b(?:\d{2}[./-]\d{2}[./-]\d{4}|\d{4}[./-]\d{2}[./-]\d{2})\b/giu,
};

const CARD_CANDIDATE_PATTERN = /\b(?:\d[ -]*?){13,19}\b/g;
const PLACEHOLDER_PATTERN = /^\{\{PII_[A-Z_]+_\d{4}\}\}$/;
const ANY_PLACEHOLDER_PATTERN = /\{\{PII_[A-Z_]+_\d{4}\}\}/g;

// The LLM anonymizer is the primary detector; regexes are safety checks only.
@Injectable()
export class PiiAnonymizerService {
  constructor(
    @Optional()
    @Inject(AnonymizerLlmProvider)
    private readonly anonymizerProvider?: AnonymizerProvider,
  ) {}

  scanMessages(messages: LlmMessage[]): PiiScanResult {
    return this.scanText(messages.map((message) => message.content).join('\n'));
  }

  scanText(text: string): PiiScanResult {
    const stats: Record<PiiKind, number> = {
      email: 0,
      phone: 0,
      inn: 0,
      snils: 0,
      passport: 0,
      bank_card: 0,
      birth_date: 0,
    };

    for (const kind of Object.keys(PII_PATTERNS) as Exclude<
      PiiKind,
      'bank_card'
    >[]) {
      stats[kind] = kind === 'inn'
        ? this.countValidInn(text)
        : this.countMatches(text, PII_PATTERNS[kind]);
    }
    stats.bank_card = this.countBankCards(text);

    return {
      hasPii: Object.values(stats).some((count) => count > 0),
      stats,
    };
  }

  async anonymizeMessages(messages: LlmMessage[]): Promise<AnonymizationResult> {
    if (!this.anonymizerProvider) {
      throw new Error('anonymizer_unavailable');
    }

    const rawResponse = await this.anonymizerProvider.anonymize({ messages });
    const parsed = this.parseStrictJson(rawResponse);

    return this.validateAnonymizerResponse(parsed, messages);
  }

  restoreText(content: string, placeholderMap: PlaceholderMap): RestoreResult {
    let restored = content;
    let restoredCount = 0;

    for (const [placeholder, rawValue] of Object.entries(placeholderMap)) {
      if (!PLACEHOLDER_PATTERN.test(placeholder)) {
        throw new Error('validation_error');
      }

      const before = restored;
      restored = restored.split(placeholder).join(rawValue);
      if (before !== restored) {
        restoredCount += 1;
      }
    }

    return {
      content: restored,
      restoredCount,
      unresolvedPlaceholders: this.extractPlaceholders(restored),
    };
  }

  private validateAnonymizerResponse(
    value: unknown,
    inputMessages: LlmMessage[],
  ): AnonymizationResult {
    if (!this.isPlainObject(value)) {
      throw new Error('validation_error');
    }

    const messages = value.messages;
    const entities = value.entities;
    const placeholderMap = value.placeholderMap;
    const stats = value.stats;

    if (
      !Array.isArray(messages) ||
      !Array.isArray(entities) ||
      !this.isStringRecord(placeholderMap) ||
      !this.isNumberRecord(stats)
    ) {
      throw new Error('validation_error');
    }

    this.validateMessages(messages, inputMessages);

    const normalizedEntities = entities.map((entity) =>
      this.validateEntity(entity, placeholderMap),
    );
    const anonymizedText = messages
      .map((message: LlmMessage) => message.content)
      .join('\n');

    this.validatePlaceholderMap(placeholderMap, normalizedEntities);
    this.assertRawValuesAreNotPresent(anonymizedText, placeholderMap);

    const safetyScan = this.scanText(anonymizedText);
    if (safetyScan.hasPii) {
      throw new Error('validation_error');
    }

    return {
      messages,
      entities: normalizedEntities,
      placeholderMap,
      semanticPlaceholderDescriptions:
        this.buildSemanticPlaceholderDescriptions(normalizedEntities),
      stats,
      dataClass: this.resolveDataClass(normalizedEntities),
    };
  }

  private validateMessages(
    messages: unknown[],
    inputMessages: LlmMessage[],
  ): asserts messages is LlmMessage[] {
    if (messages.length !== inputMessages.length) {
      throw new Error('validation_error');
    }

    messages.forEach((message, index) => {
      const inputMessage = inputMessages[index];
      if (
        !this.isPlainObject(message) ||
        message.role !== inputMessage.role ||
        typeof message.content !== 'string' ||
        message.content.trim().length === 0
      ) {
        throw new Error('validation_error');
      }
    });
  }

  private validateEntity(
    entity: unknown,
    placeholderMap: PlaceholderMap,
  ): DetectedPiiEntity {
    if (
      !this.isPlainObject(entity) ||
      typeof entity.placeholder !== 'string' ||
      typeof entity.type !== 'string' ||
      typeof entity.description !== 'string'
    ) {
      throw new Error('validation_error');
    }

    if (!this.isSupportedEntityType(entity.type)) {
      throw new Error('validation_error');
    }

    if (
      !PLACEHOLDER_PATTERN.test(entity.placeholder) ||
      !this.placeholderMatchesType(entity.placeholder, entity.type) ||
      typeof placeholderMap[entity.placeholder] !== 'string' ||
      entity.description.trim().length === 0
    ) {
      throw new Error('validation_error');
    }

    return {
      placeholder: entity.placeholder,
      type: entity.type,
      description: entity.description,
    };
  }

  private validatePlaceholderMap(
    placeholderMap: PlaceholderMap,
    entities: DetectedPiiEntity[],
  ): void {
    const entityPlaceholders = new Set(
      entities.map((entity) => entity.placeholder),
    );

    for (const placeholder of Object.keys(placeholderMap)) {
      if (!PLACEHOLDER_PATTERN.test(placeholder)) {
        throw new Error('validation_error');
      }

      if (!entityPlaceholders.has(placeholder)) {
        throw new Error('validation_error');
      }
    }
  }

  private assertRawValuesAreNotPresent(
    anonymizedText: string,
    placeholderMap: PlaceholderMap,
  ): void {
    for (const rawValue of Object.values(placeholderMap)) {
      if (rawValue && anonymizedText.includes(rawValue)) {
        throw new Error('validation_error');
      }
    }
  }

  private resolveDataClass(entities: DetectedPiiEntity[]): DataClass {
    if (entities.length === 0) {
      return DataClass.NoPii;
    }

    if (
      entities.some((entity) => HIGH_SENSITIVE_ENTITY_TYPES.has(entity.type))
    ) {
      return DataClass.HighSensitive;
    }

    return DataClass.AnonymizedPii;
  }

  private buildSemanticPlaceholderDescriptions(
    entities: DetectedPiiEntity[],
  ): SemanticPlaceholderDescriptions {
    return entities.reduce<SemanticPlaceholderDescriptions>((acc, entity) => {
      acc[entity.placeholder] = entity.description;
      return acc;
    }, {});
  }

  private parseStrictJson(rawResponse: string): unknown {
    try {
      return JSON.parse(rawResponse);
    } catch {
      throw new Error('validation_error');
    }
  }

  private countMatches(text: string, pattern: RegExp): number {
    return Array.from(text.matchAll(new RegExp(pattern.source, pattern.flags)))
      .length;
  }

  private countBankCards(text: string): number {
    return Array.from(text.matchAll(CARD_CANDIDATE_PATTERN)).filter((match) =>
      this.isLuhnValid(match[0].replace(/\D/g, '')),
    ).length;
  }

  private countValidInn(text: string): number {
    return Array.from(text.matchAll(PII_PATTERNS.inn)).filter((match) =>
      this.isInnValid(match[0]),
    ).length;
  }

  private isInnValid(value: string): boolean {
    const digits = value.split('').map((digit) => Number(digit));
    if (!digits.every((digit) => Number.isInteger(digit))) {
      return false;
    }

    if (digits.length === 10) {
      return this.innChecksum(digits, [2, 4, 10, 3, 5, 9, 4, 6, 8]) === digits[9];
    }

    if (digits.length === 12) {
      return this.innChecksum(digits, [7, 2, 4, 10, 3, 5, 9, 4, 6, 8]) === digits[10]
        && this.innChecksum(digits, [3, 7, 2, 4, 10, 3, 5, 9, 4, 6, 8]) === digits[11];
    }

    return false;
  }

  private innChecksum(digits: number[], coefficients: number[]): number {
    const sum = coefficients.reduce(
      (acc, coefficient, index) => acc + coefficient * digits[index],
      0,
    );
    return (sum % 11) % 10;
  }

  private isLuhnValid(value: string): boolean {
    if (value.length < 13 || value.length > 19) {
      return false;
    }

    let sum = 0;
    let shouldDouble = false;
    for (let index = value.length - 1; index >= 0; index -= 1) {
      let digit = Number(value[index]);
      if (!Number.isInteger(digit)) {
        return false;
      }

      if (shouldDouble) {
        digit *= 2;
        if (digit > 9) {
          digit -= 9;
        }
      }

      sum += digit;
      shouldDouble = !shouldDouble;
    }

    return sum % 10 === 0;
  }

  private extractPlaceholders(content: string): string[] {
    return Array.from(new Set(content.match(ANY_PLACEHOLDER_PATTERN) ?? []));
  }

  private placeholderMatchesType(
    placeholder: string,
    type: PiiEntityType,
  ): boolean {
    const placeholderType = `PII_${type.toUpperCase()}_`;
    return placeholder.startsWith(`{{${placeholderType}`);
  }

  private isSupportedEntityType(type: string): type is PiiEntityType {
    return SUPPORTED_ENTITY_TYPES.includes(type as PiiEntityType);
  }

  private isPlainObject(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value));
  }

  private isStringRecord(value: unknown): value is Record<string, string> {
    return (
      this.isPlainObject(value) &&
      Object.values(value).every((entry) => typeof entry === 'string')
    );
  }

  private isNumberRecord(value: unknown): value is Record<string, number> {
    return (
      this.isPlainObject(value) &&
      Object.values(value).every((entry) => typeof entry === 'number')
    );
  }
}
