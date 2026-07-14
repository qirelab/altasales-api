import { Injectable } from '@nestjs/common';
import { ChatbotHistoryEntry } from '../../chatbot/services/chatbot-conversational-context.service';
import { ChatMessage } from '../entities/chat-message.entity';

/**
 * Turns a chronologically-ordered slice of ChatMessage rows into the generic
 * ChatbotHistoryEntry[] shape consumed by ChatbotRagService.askQuestion.
 *
 * Mapping rules (per QIR-256 spec, section 8):
 *   - the client's own messages → role: 'user'
 *   - AI messages (isAiGenerated) → role: 'assistant'
 *   - expert / operator messages → role: 'assistant' — they speak as the
 *     platform to the client, so the LLM sees them as part of the same
 *     "assistant" persona and does not contradict what a human already said.
 *
 * The mapper is intentionally storage-agnostic — the caller decides how many
 * messages to load and in what order; we only transform the shape.
 */
@Injectable()
export class ChatHistoryMapperService {
  toHistoryEntries(
    messagesAsc: ChatMessage[],
    clientUserId: string,
  ): ChatbotHistoryEntry[] {
    return messagesAsc.map((message) => ({
      role: this.roleFor(message, clientUserId),
      content: message.text,
    }));
  }

  private roleFor(
    message: ChatMessage,
    clientUserId: string,
  ): 'user' | 'assistant' {
    if (message.senderId === clientUserId && !message.isAiGenerated) {
      return 'user';
    }
    return 'assistant';
  }
}
