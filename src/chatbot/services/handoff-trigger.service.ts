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
 * We deliberately require a call-to-action verb next to the noun instead of
 * matching bare «менеджер»/«оператор»/«специалист»/«человек». Bare nouns
 * appear routinely in ordinary product questions («оператор сотовой связи»,
 * «наш специалист по маркетингу», «менеджерский подход») and would produce
 * false handoffs. Pairing with an intent verb lets us keep the pattern list
 * short while covering the phrasing we actually want to react to.
 *
 * Note: JavaScript's `\b` word boundary is ASCII-only, so it does not fire
 * between whitespace and Cyrillic letters. Patterns anchor on literal
 * Cyrillic stems (e.g. `менеджер` requires the full 8-letter prefix), and
 * the morphological tail is captured with `[а-я]*` — enough to avoid
 * partial-substring false positives.
 */

/** Verbs and modal expressions that mean "put me in touch with X". */
const HANDOFF_CTA = [
  'хочу',
  'хочется',
  'нужен',
  'нужна',
  'нужно',
  'дайте',
  'давайте',
  'можно',
  'позов(?:и|ите)',
  'подключ(?:и|ите)',
  'соедин(?:и|ите)',
  'свяж(?:и|ите|итесь)',
  'позвон(?:и|ите)',
  'поговорить',
  'пообщаться',
].join('|');

/** Words for the human role we want the client to land on. */
const HANDOFF_HUMAN_NOUN = '(?:менеджер|оператор|специалист|человек)[а-я]*';

export const HANDOFF_KEYWORD_PATTERNS: RegExp[] = [
  // Verb + optional linking preposition + noun. Covers
  //   «Позовите менеджера»
  //   «Хочу поговорить со специалистом»
  //   «Соедините меня с оператором»
  //   «Можно к человеку»
  //   «Дайте мне живого человека» (falls through to the "живой" rule below,
  //   but also matches here)
  new RegExp(
    `(?:${HANDOFF_CTA})\\s+(?:(?:мне|меня)\\s+)?(?:к\\s+|с\\s+|со\\s+)?${HANDOFF_HUMAN_NOUN}`,
    'i',
  ),
  // «живой человек / оператор / специалист» — standalone phrase that
  // signals intent even without an explicit verb ("нужен живой оператор!").
  /жив[а-я]{1,4}\s+(?:человек|оператор|специалист)/i,
];

/**
 * RAG refusal reasons that fall into the "we lack the ground truth" bucket.
 * Only `no_results_in_scope` counts — this is the case where the intent
 * classifier confirmed the question is about the AltaSales platform, but
 * the knowledge base had no answer. An unclassified `no_results` alone
 * (without in-scope confirmation) is NOT a handoff signal — off-topic
 * questions like "что о политике?" produce `no_results` too and must not
 * page a human operator.
 *
 * `explicit_handoff` is the client's own request routed through the RAG
 * refusal channel so orchestrator handoff logic stays a single code path.
 *
 * Everything else (retrieval / generation / oversize failures) is classified
 * as infrastructure error — a distinct signal so downstream can decide
 * whether to alert the operator differently.
 */
const NO_CONTEXT_REASONS: ReadonlySet<ChatbotRagRefusalReason> =
  new Set<ChatbotRagRefusalReason>([
    'no_results_in_scope',
    'explicit_handoff',
  ]);

/**
 * Infrastructure failures. These get their own trigger so operators can
 * distinguish "we broke" from "we don't have the answer."
 */
const INFRA_REASONS: ReadonlySet<ChatbotRagRefusalReason> =
  new Set<ChatbotRagRefusalReason>([
    'retrieval_failed',
    'generation_failed',
    'empty_llm_response',
    'context_too_large',
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
    if (INFRA_REASONS.has(reason)) {
      return { needsHandoff: true, trigger: ChatHandoffTrigger.RagInfraError };
    }
    // Legacy / non-triggering reasons (empty_question, no_results, below_threshold)
    // reach here. They must not page a human: empty_question means the client
    // sent nothing; no_results / below_threshold now only surface when the
    // intent classifier chose NOT to escalate (off-topic questions).
    return { needsHandoff: false };
  }

  private matchesExplicitRequest(message: string): boolean {
    if (!message) return false;
    return HANDOFF_KEYWORD_PATTERNS.some((rx) => rx.test(message));
  }
}
