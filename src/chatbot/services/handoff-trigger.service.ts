import { Injectable } from '@nestjs/common';
import { ChatHandoffTrigger } from '../../chat/entities/chat-handoff-trigger.enum';
import type {
  ChatbotRagRefusalReason,
  ChatbotRagResponse,
} from './chatbot-rag.service';

/**
 * Regex patterns that flag an explicit human-handoff request in a Russian
 * client message. Exported so specs assert the exact rule set and future
 * additions land in one obvious place. Every pattern is case-insensitive.
 *
 * Note: JavaScript's `\b` word boundary is ASCII-only, so it does not fire
 * between whitespace and Cyrillic letters. We therefore anchor patterns on
 * literal Cyrillic stems (e.g. `менеджер` requires an exact 8-letter prefix)
 * and use `[а-я]*` for the morphological tail. This is enough to avoid
 * false positives on unrelated words like «менее», which shares only the
 * first four letters and never spells out the full stem.
 */
export const HANDOFF_KEYWORD_PATTERNS: RegExp[] = [
  /менеджер[а-я]*/i,
  /специалист[а-я]*/i,
  /оператор[а-я]*/i,
  /жив[а-я]{1,4}\s+(?:человек|оператор|специалист)/i,
  /свяж(?:ите|итесь|и)\s+(?:меня\s+)?с\s+(?:менеджер|человек|оператор|специалист)/i,
  /подключ(?:ите|и)\s+(?:менеджер|человек|оператор|специалист)/i,
  /поговорить\s+с\s+(?:менеджер|человек|оператор|специалист)/i,
  /позов(?:ите|и)\s+(?:менеджер|человек|оператор|специалист)/i,
];

/**
 * RAG refusal reasons that fall into the "we lack the ground truth" bucket.
 * Everything else (retrieval / generation / oversize failures) is classified
 * as infrastructure error — a distinct signal so downstream can decide
 * whether to alert the operator differently.
 */
const NO_CONTEXT_REASONS: ReadonlySet<ChatbotRagRefusalReason> =
  new Set<ChatbotRagRefusalReason>([
    'empty_question',
    'no_results',
    'below_threshold',
  ]);

export type HandoffDetection =
  | { needsHandoff: false }
  | { needsHandoff: true; trigger: ChatHandoffTrigger };

export interface HandoffTriggerInput {
  clientMessage: string;
  ragResponse?: ChatbotRagResponse;
}

@Injectable()
export class HandoffTriggerService {
  detect(input: HandoffTriggerInput): HandoffDetection {
    // Priority 1: the client asked for a human in plain text. Cheapest to
    // check and semantically wins over any subsequent RAG signal — if the
    // client asked, we honour the ask even if RAG happened to succeed.
    if (this.matchesExplicitRequest(input.clientMessage)) {
      return {
        needsHandoff: true,
        trigger: ChatHandoffTrigger.UserExplicitRequest,
      };
    }

    // Priority 2 & 3 depend on the RAG outcome. If there was no RAG call
    // (e.g. we short-circuited elsewhere), there is nothing to escalate on.
    const reason = input.ragResponse?.refusalReason;
    if (!reason) return { needsHandoff: false };

    if (NO_CONTEXT_REASONS.has(reason)) {
      return { needsHandoff: true, trigger: ChatHandoffTrigger.RagNoContext };
    }
    return { needsHandoff: true, trigger: ChatHandoffTrigger.RagInfraError };
  }

  private matchesExplicitRequest(message: string): boolean {
    if (!message) return false;
    return HANDOFF_KEYWORD_PATTERNS.some((rx) => rx.test(message));
  }
}
