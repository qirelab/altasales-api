import { Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const DEFAULT_MAX_MESSAGES = 10;
const DEFAULT_MAX_CHARS = 8_000;

/**
 * Trims a chronologically ordered chat history to a size we're willing to send
 * to the LLM. Walks from the most recent message backwards, keeping messages
 * while both the message count and the character budget allow it. The newest
 * message is always kept even if it exceeds the char budget alone.
 */
@Injectable()
export class ChatbotHistorySlicerService {
  private readonly maxMessages: number;
  private readonly maxChars: number;

  constructor(@Optional() private readonly configService?: ConfigService) {
    this.maxMessages = this.readPositiveInt(
      'CHATBOT_HISTORY_MAX_MESSAGES',
      DEFAULT_MAX_MESSAGES,
    );
    this.maxChars = this.readPositiveInt(
      'CHATBOT_HISTORY_MAX_CHARS',
      DEFAULT_MAX_CHARS,
    );
  }

  slice<T extends { content: string }>(messagesAsc: T[]): T[] {
    if (!messagesAsc.length) return [];

    const reversed = [...messagesAsc].reverse();
    const keptDesc: T[] = [];
    let usedChars = 0;
    for (const message of reversed) {
      if (keptDesc.length >= this.maxMessages) break;
      const nextChars = usedChars + message.content.length;
      if (keptDesc.length > 0 && nextChars > this.maxChars) break;
      keptDesc.push(message);
      usedChars = nextChars;
    }
    return keptDesc.reverse();
  }

  private readPositiveInt(key: string, fallback: number): number {
    const raw = this.configService?.get<string | number>(key);
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
  }
}
