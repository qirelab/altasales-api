import { ChatHistoryMapperService } from './chat-history-mapper.service';
import { ChatMessage } from '../entities/chat-message.entity';

function msg(overrides: Partial<ChatMessage>): ChatMessage {
  return {
    id: overrides.id ?? 'm-1',
    conversationId: overrides.conversationId ?? 'conv-1',
    conversation: undefined as never,
    senderId: overrides.senderId ?? 'client-1',
    sender: undefined as never,
    text: overrides.text ?? 'hello',
    isRead: overrides.isRead ?? false,
    isAiGenerated: overrides.isAiGenerated ?? false,
    createdAt: overrides.createdAt ?? new Date(),
  } as ChatMessage;
}

describe('ChatHistoryMapperService', () => {
  const service = new ChatHistoryMapperService();
  const clientId = 'client-1';
  const aiId = 'ai-1';
  const expertId = 'expert-1';

  it('returns empty array for empty input', () => {
    expect(service.toHistoryEntries([], clientId)).toEqual([]);
  });

  it('maps client messages to role=user', () => {
    const result = service.toHistoryEntries(
      [msg({ senderId: clientId, text: 'Q1' })],
      clientId,
    );
    expect(result).toEqual([{ role: 'user', content: 'Q1' }]);
  });

  it('maps AI messages to role=assistant based on isAiGenerated', () => {
    const result = service.toHistoryEntries(
      [msg({ senderId: aiId, isAiGenerated: true, text: 'A1' })],
      clientId,
    );
    expect(result).toEqual([{ role: 'assistant', content: 'A1' }]);
  });

  it('maps expert messages to role=assistant (same persona as AI)', () => {
    const result = service.toHistoryEntries(
      [msg({ senderId: expertId, isAiGenerated: false, text: 'From expert' })],
      clientId,
    );
    expect(result).toEqual([{ role: 'assistant', content: 'From expert' }]);
  });

  it('preserves chronological order of an interleaved dialog', () => {
    const result = service.toHistoryEntries(
      [
        msg({ id: '1', senderId: clientId, text: 'Q1' }),
        msg({ id: '2', senderId: aiId, isAiGenerated: true, text: 'A1' }),
        msg({ id: '3', senderId: clientId, text: 'Q2' }),
        msg({ id: '4', senderId: expertId, text: 'Expert weighs in' }),
        msg({ id: '5', senderId: aiId, isAiGenerated: true, text: 'A2' }),
      ],
      clientId,
    );
    expect(result).toEqual([
      { role: 'user', content: 'Q1' },
      { role: 'assistant', content: 'A1' },
      { role: 'user', content: 'Q2' },
      { role: 'assistant', content: 'Expert weighs in' },
      { role: 'assistant', content: 'A2' },
    ]);
  });

  it('treats a client-authored message with isAiGenerated=true as assistant (defensive)', () => {
    // Edge case: senderId=client BUT isAiGenerated=true. Trust the flag —
    // real data should never have this, but a defensive default protects
    // the LLM prompt from a mislabeled "user" turn full of AI text.
    const result = service.toHistoryEntries(
      [msg({ senderId: clientId, isAiGenerated: true, text: 'weird' })],
      clientId,
    );
    expect(result).toEqual([{ role: 'assistant', content: 'weird' }]);
  });
});
