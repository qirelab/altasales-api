import { Injectable } from '@nestjs/common';
import { LlmMessage } from './interfaces/llm-message.interface';
import { PiiScanResult } from './interfaces/pii-scan-result.interface';

type PiiKind = 'email' | 'phone' | 'inn';

const PII_PATTERNS: Record<PiiKind, RegExp> = {
  email: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
  phone: /(?:\+7|8)\s*(?:\(\d{3}\)|\d{3})[\s-]*\d{3}[\s-]*\d{2}[\s-]*\d{2}/g,
  inn: /\b\d{10}(?:\d{2})?\b/g,
};

// Baseline detector used to fail closed before LLM calls.
@Injectable()
export class PiiAnonymizerService {
  scanMessages(messages: LlmMessage[]): PiiScanResult {
    return this.scanText(messages.map((message) => message.content).join('\n'));
  }

  scanText(text: string): PiiScanResult {
    const stats: Record<PiiKind, number> = { email: 0, phone: 0, inn: 0 };
    for (const kind of Object.keys(PII_PATTERNS) as PiiKind[]) {
      stats[kind] = this.countMatches(text, PII_PATTERNS[kind]);
    }

    return {
      hasPii: Object.values(stats).some((count) => count > 0),
      stats,
    };
  }

  private countMatches(text: string, pattern: RegExp): number {
    return Array.from(text.matchAll(new RegExp(pattern.source, pattern.flags)))
      .length;
  }
}
