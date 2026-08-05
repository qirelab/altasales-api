import { ChatHandoffTrigger } from '../../chat/entities/chat-handoff-trigger.enum';
import type { ChatbotRagResponse } from './chatbot-rag.service';
import {
  HANDOFF_KEYWORD_PATTERNS,
  HandoffTriggerService,
} from './handoff-trigger.service';

function makeRag(
  overrides: Partial<ChatbotRagResponse> = {},
): ChatbotRagResponse {
  return {
    answer: overrides.answer ?? 'ok',
    hasContext: overrides.hasContext ?? true,
    sources: overrides.sources ?? [],
    refusalReason: overrides.refusalReason,
  };
}

describe('HandoffTriggerService.detect', () => {
  const service = new HandoffTriggerService();

  it('does not fire when the client message is empty and RAG succeeded', () => {
    expect(
      service.detect({
        clientMessage: '',
        ragResponse: makeRag(),
      }),
    ).toEqual({ needsHandoff: false });
  });

  it('fires user_explicit_request when the client mentions a manager', () => {
    const result = service.detect({
      clientMessage: 'Здравствуйте, соедините меня с менеджером, пожалуйста',
      ragResponse: makeRag(),
    });
    expect(result).toEqual({
      needsHandoff: true,
      trigger: ChatHandoffTrigger.UserExplicitRequest,
    });
  });

  it('fires user_explicit_request when the client asks for a "живой человек"', () => {
    const result = service.detect({
      clientMessage: 'Хочу поговорить с живым человеком, а не с ботом',
    });
    expect(result).toEqual({
      needsHandoff: true,
      trigger: ChatHandoffTrigger.UserExplicitRequest,
    });
  });

  it('prioritises explicit user request over a successful RAG answer', () => {
    const result = service.detect({
      clientMessage: 'Позовите оператора, вопрос сложный',
      ragResponse: makeRag({ refusalReason: undefined }),
    });
    expect(result).toEqual({
      needsHandoff: true,
      trigger: ChatHandoffTrigger.UserExplicitRequest,
    });
  });

  it.each(['no_results_in_scope', 'explicit_handoff'] as const)(
    'fires rag_no_context on refusalReason %s',
    (reason) => {
      const result = service.detect({
        clientMessage: 'Какой пакет мне подойдёт?',
        ragResponse: makeRag({ refusalReason: reason }),
      });
      expect(result).toEqual({
        needsHandoff: true,
        trigger: ChatHandoffTrigger.RagNoContext,
      });
    },
  );

  it.each(['empty_question', 'no_results', 'below_threshold'] as const)(
    'does NOT fire handoff on legacy refusalReason %s (off-topic protection)',
    (reason) => {
      const result = service.detect({
        clientMessage: 'Что о политике?',
        ragResponse: makeRag({ refusalReason: reason }),
      });
      expect(result).toEqual({ needsHandoff: false });
    },
  );

  it.each([
    'retrieval_failed',
    'generation_failed',
    'empty_llm_response',
    'context_too_large',
  ] as const)('fires rag_infra_error on refusalReason %s', (reason) => {
    const result = service.detect({
      clientMessage: 'Расскажите про CRM Silver',
      ragResponse: makeRag({ refusalReason: reason }),
    });
    expect(result).toEqual({
      needsHandoff: true,
      trigger: ChatHandoffTrigger.RagInfraError,
    });
  });

  it('does not fire on an unrelated word that only overlaps a substring', () => {
    // "менее" contains "мене" — pattern must NOT match without the full stem.
    const result = service.detect({
      clientMessage: 'Мне менее интересен CRM Bronze, чем Silver',
    });
    expect(result).toEqual({ needsHandoff: false });
  });

  it('does not fire on plain product/pricing question when RAG succeeded', () => {
    const result = service.detect({
      clientMessage: 'Сколько стоит пакет CRM Silver?',
      ragResponse: makeRag(),
    });
    expect(result).toEqual({ needsHandoff: false });
  });

  it.each([
    'Оператор сотовой связи задерживает подтверждение',
    'Наш специалист по маркетингу спросил про CRM',
    'Менеджерский подход в вашей компании',
    'Я работаю оператором call-центра',
    'Наши менеджеры обучились в прошлом квартале',
    'Есть ли у вас специалист по интеграциям?',
  ])(
    'does not fire when the noun appears without a call-to-action verb (%s)',
    (message) => {
      expect(service.detect({ clientMessage: message })).toEqual({
        needsHandoff: false,
      });
    },
  );

  it('fires on «хочу к человеку» — CTA + человек without «живой»', () => {
    expect(
      service.detect({
        clientMessage: 'Спасибо, хочу к человеку, а не боту',
      }),
    ).toEqual({
      needsHandoff: true,
      trigger: ChatHandoffTrigger.UserExplicitRequest,
    });
  });

  it('fires on «дайте оператора» — imperative + оператор', () => {
    expect(
      service.detect({
        clientMessage: 'Дайте оператора уже, надоел бот',
      }),
    ).toEqual({
      needsHandoff: true,
      trigger: ChatHandoffTrigger.UserExplicitRequest,
    });
  });

  it('exports a non-empty pattern list so callers can extend it', () => {
    expect(HANDOFF_KEYWORD_PATTERNS.length).toBeGreaterThan(0);
    HANDOFF_KEYWORD_PATTERNS.forEach((rx) => {
      expect(rx).toBeInstanceOf(RegExp);
      expect(rx.flags).toContain('i');
    });
  });
});
