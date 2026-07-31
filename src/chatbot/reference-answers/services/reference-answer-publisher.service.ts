import { Injectable, Logger } from '@nestjs/common';
import { KnowledgeBasePurpose } from '../../../knowledge/enums/knowledge-base-purpose.enum';
import { KnowledgeDocumentsService } from '../../../knowledge/services/knowledge-documents.service';
import { ChatbotReferenceAnswer } from '../entities/chatbot-reference-answer.entity';

const MAX_TITLE_CHARS = 120;

@Injectable()
export class ReferenceAnswerPublisherService {
  private readonly logger = new Logger(ReferenceAnswerPublisherService.name);

  constructor(
    private readonly documentsService: KnowledgeDocumentsService,
  ) {}

  async publish(
    answer: ChatbotReferenceAnswer,
  ): Promise<string | null> {
    try {
      const result = await this.documentsService.createFromText({
        title: this.buildTitle(answer),
        text: this.buildText(answer),
        purpose: KnowledgeBasePurpose.QA_CHATBOT,
        metadata: {
          referenceAnswerId: answer.id,
          topic: answer.topic,
          isReferenceAnswer: true,
        },
      });
      return result.documentId;
    } catch (error) {
      this.logger.error({
        eventName: 'REFERENCE_ANSWER_PUBLISH_FAILED',
        referenceAnswerId: answer.id,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  async unpublish(documentId: string | null): Promise<void> {
    if (!documentId) return;
    try {
      await this.documentsService.delete(documentId);
    } catch (error) {
      this.logger.warn({
        eventName: 'REFERENCE_ANSWER_UNPUBLISH_FAILED',
        documentId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private buildTitle(answer: ChatbotReferenceAnswer): string {
    const base = `[Эталон] ${answer.topic}: ${answer.question}`;
    return base.slice(0, MAX_TITLE_CHARS);
  }

  private buildText(answer: ChatbotReferenceAnswer): string {
    return [
      `Вопрос: ${answer.question.trim()}`,
      `Ответ: ${answer.answer.trim()}`,
      `Тема: ${answer.topic.trim()}`,
    ].join('\n');
  }
}
