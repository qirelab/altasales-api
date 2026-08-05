import { AI_SYSTEM_USER_ID } from '../chat.constants';
import { SessionTitleService } from './session-title.service';

function buildService(
  overrides: {
    llmResponse?: string;
    llmThrows?: Error;
    updateAffected?: number;
    participants?: { userId: string }[];
  } = {},
) {
  const conditionalExecute = jest
    .fn()
    .mockResolvedValue({ affected: overrides.updateAffected ?? 1 });
  const sessionRepository = {
    createQueryBuilder: jest.fn(() => ({
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      execute: conditionalExecute,
    })),
  };
  const participantRepository = {
    find: jest.fn().mockResolvedValue(
      overrides.participants ?? [
        { userId: 'client-1' },
        { userId: AI_SYSTEM_USER_ID },
      ],
    ),
  };
  const llm = {
    chat: overrides.llmThrows
      ? jest.fn().mockRejectedValue(overrides.llmThrows)
      : jest.fn().mockResolvedValue({ content: overrides.llmResponse ?? 'Тестовый заголовок' }),
  };
  const wsGateway = { emitToUser: jest.fn() };
  const service = new SessionTitleService(
    sessionRepository as never,
    participantRepository as never,
    llm as never,
    wsGateway as never,
  );
  return { service, sessionRepository, participantRepository, llm, wsGateway, conditionalExecute };
}

describe('SessionTitleService.generateAndAssign', () => {
  it('does nothing when the message text is empty/whitespace', async () => {
    const { service, llm } = buildService();
    await service.generateAndAssign('conv-1', '   \n\t  ');
    expect(llm.chat).not.toHaveBeenCalled();
  });

  it('calls LLM with Chatbot agent + Summarize task + system/user messages', async () => {
    const { service, llm } = buildService();
    await service.generateAndAssign('conv-1', 'Как настроить отдел продаж?');
    expect(llm.chat).toHaveBeenCalledTimes(1);
    const arg = llm.chat.mock.calls[0][0];
    expect(arg.agentId).toBe('chatbot');
    expect(arg.task).toBe('summarize');
    expect(arg.messages[0].role).toBe('system');
    expect(arg.messages[1]).toEqual({ role: 'user', content: 'Как настроить отдел продаж?' });
  });

  it('persists sanitized title with conditional UPDATE and emits WS to non-AI participants', async () => {
    const { service, sessionRepository, wsGateway } = buildService({
      llmResponse: '  «Настройка отдела продаж»  ',
      participants: [
        { userId: 'client-1' },
        { userId: 'expert-9' },
        { userId: AI_SYSTEM_USER_ID },
      ],
    });

    await service.generateAndAssign('conv-1', 'q?');

    // Conditional UPDATE issued through query builder.
    expect(sessionRepository.createQueryBuilder).toHaveBeenCalled();

    // WS emit went to client + expert, NOT to AI system user.
    const targets = wsGateway.emitToUser.mock.calls
      .filter((call) => call[1] === 'chat:session_updated')
      .map((call) => call[0]);
    expect(targets.sort()).toEqual(['client-1', 'expert-9'].sort());
    expect(targets).not.toContain(AI_SYSTEM_USER_ID);

    const payload = wsGateway.emitToUser.mock.calls[0][2] as { sessionId: string; title: string };
    expect(payload.sessionId).toBe('conv-1');
    // Quotes stripped by sanitize.
    expect(payload.title).toBe('Настройка отдела продаж');
  });

  it('strips "Тема:" / "Title:" prefixes the LLM adds despite the prompt', async () => {
    const { service, wsGateway } = buildService({
      llmResponse: 'Тема: Настройка отдела продаж.',
    });
    await service.generateAndAssign('conv-1', 'q?');
    const payload = wsGateway.emitToUser.mock.calls[0][2] as { title: string };
    expect(payload.title).toBe('Настройка отдела продаж');
  });

  it('truncates long titles to 60 chars with ellipsis', async () => {
    const longTitle = 'Очень подробный длинный заголовок про настройку и внедрение большого отдела продаж';
    const { service, wsGateway } = buildService({ llmResponse: longTitle });
    await service.generateAndAssign('conv-1', 'q?');
    const payload = wsGateway.emitToUser.mock.calls[0][2] as { title: string };
    expect(payload.title.length).toBeLessThanOrEqual(60);
    expect(payload.title.endsWith('…')).toBe(true);
  });

  it('does NOT emit WS when conditional UPDATE affects zero rows (someone else won the race)', async () => {
    const { service, wsGateway } = buildService({ updateAffected: 0 });
    await service.generateAndAssign('conv-1', 'q?');
    const sessionUpdates = wsGateway.emitToUser.mock.calls.filter(
      (call) => call[1] === 'chat:session_updated',
    );
    expect(sessionUpdates).toHaveLength(0);
  });

  it('swallows LLM errors (warn-log only, no throw, no UPDATE, no WS)', async () => {
    const { service, sessionRepository, wsGateway } = buildService({
      llmThrows: new Error('LLM boom'),
    });
    await expect(
      service.generateAndAssign('conv-1', 'q?'),
    ).resolves.toBeUndefined();
    expect(sessionRepository.createQueryBuilder).not.toHaveBeenCalled();
    expect(wsGateway.emitToUser).not.toHaveBeenCalled();
  });

  it('de-dupes concurrent generation for the same session (in-flight guard)', async () => {
    const { service, llm } = buildService();
    // Fire two calls in parallel — the second must return without calling LLM.
    await Promise.all([
      service.generateAndAssign('conv-1', 'q1'),
      service.generateAndAssign('conv-1', 'q2'),
    ]);
    expect(llm.chat).toHaveBeenCalledTimes(1);
  });

  it('empty sanitized title (all whitespace/quotes) does nothing', async () => {
    const { service, sessionRepository, wsGateway } = buildService({
      llmResponse: '   """   ',
    });
    await service.generateAndAssign('conv-1', 'q?');
    expect(sessionRepository.createQueryBuilder).not.toHaveBeenCalled();
    expect(wsGateway.emitToUser).not.toHaveBeenCalled();
  });
});
