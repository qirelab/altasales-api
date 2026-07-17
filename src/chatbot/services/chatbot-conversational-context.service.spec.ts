import { ChatbotConversationalContextService } from './chatbot-conversational-context.service';

function buildContext() {
  const slicer = {
    slice: jest.fn((messages) => messages),
  };
  const service = new ChatbotConversationalContextService(slicer as never);
  return { service, slicer };
}

describe('ChatbotConversationalContextService', () => {
  it('returns empty context and does not touch slicer when history is empty', () => {
    const { service, slicer } = buildContext();
    const result = service.build([]);
    expect(result).toEqual({ historyMessages: [], usedHistoryCount: 0 });
    expect(slicer.slice).not.toHaveBeenCalled();
  });

  it('slices history and maps it to LlmMessage[]', () => {
    const { service, slicer } = buildContext();
    const result = service.build([
      { role: 'user', content: 'Q1' },
      { role: 'assistant', content: 'A1' },
    ]);

    expect(slicer.slice).toHaveBeenCalledWith([
      { role: 'user', content: 'Q1' },
      { role: 'assistant', content: 'A1' },
    ]);
    expect(result.historyMessages).toEqual([
      { role: 'user', content: 'Q1' },
      { role: 'assistant', content: 'A1' },
    ]);
    expect(result.usedHistoryCount).toBe(2);
  });

  it('reports usedHistoryCount from the sliced (not original) history', () => {
    const { service, slicer } = buildContext();
    slicer.slice.mockReturnValueOnce([
      { role: 'assistant', content: 'A1' },
    ]);
    const result = service.build([
      { role: 'user', content: 'Q0' },
      { role: 'assistant', content: 'A0' },
      { role: 'user', content: 'Q1' },
      { role: 'assistant', content: 'A1' },
    ]);
    expect(result.usedHistoryCount).toBe(1);
    expect(result.historyMessages).toEqual([{ role: 'assistant', content: 'A1' }]);
  });
});
