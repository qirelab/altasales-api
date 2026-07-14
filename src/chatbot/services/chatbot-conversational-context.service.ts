import { Injectable } from '@nestjs/common';
import type { LlmMessage } from '../../ai/interfaces/llm-message.interface';
import { ChatbotHistorySlicerService } from './chatbot-history-slicer.service';

export type ChatbotHistoryEntry = {
  role: 'user' | 'assistant';
  content: string;
};

export type ConversationalContext = {
  historyMessages: LlmMessage[];
  usedHistoryCount: number;
};

/**
 * Thin coordinator that turns raw chronological history (from any source —
 * `chat_message`, tests, whatever) into a sliced `LlmMessage[]` ready to be
 * prepended to the RAG prompt. The caller (e.g. the future ChatService
 * integration) owns loading history from the DB; this service is agnostic
 * of the underlying storage.
 */
@Injectable()
export class ChatbotConversationalContextService {
  constructor(private readonly slicer: ChatbotHistorySlicerService) {}

  build(historyAsc: ChatbotHistoryEntry[]): ConversationalContext {
    if (!historyAsc.length) {
      return { historyMessages: [], usedHistoryCount: 0 };
    }
    const sliced = this.slicer.slice(historyAsc);
    const historyMessages: LlmMessage[] = sliced.map((entry) => ({
      role: entry.role,
      content: entry.content,
    }));
    return { historyMessages, usedHistoryCount: historyMessages.length };
  }
}
