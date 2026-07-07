import { validate } from 'class-validator';
import { ChatbotController } from './chatbot.controller';
import { AskChatbotDto } from './dto/ask-chatbot.dto';
import { ChatbotRagResponse, ChatbotRagService } from './services/chatbot-rag.service';

function buildController(ragImpl?: Partial<ChatbotRagService>) {
  const chatbotRag = {
    askQuestion: jest.fn().mockResolvedValue({
      answer: 'Ответ бота.',
      hasContext: true,
      sources: [
        {
          documentId: 'doc-1',
          documentTitle: 'Guide',
          chunkIndex: 0,
          score: 0.9,
        },
      ],
    } as ChatbotRagResponse),
    ...ragImpl,
  };
  const controller = new ChatbotController(chatbotRag as never);
  return { controller, chatbotRag };
}

async function buildDto(overrides: Partial<AskChatbotDto>): Promise<AskChatbotDto> {
  const dto = new AskChatbotDto();
  Object.assign(dto, overrides);
  return dto;
}

describe('ChatbotController', () => {
  describe('POST /chatbot/ask', () => {
    it('forwards the trimmed question to ChatbotRagService and returns its response', async () => {
      const { controller, chatbotRag } = buildController();

      const result = await controller.ask({ question: 'Сколько стоит CRM Silver?' });

      expect(chatbotRag.askQuestion).toHaveBeenCalledWith({ question: 'Сколько стоит CRM Silver?' });
      expect(result.hasContext).toBe(true);
      expect(result.answer).toBe('Ответ бота.');
      expect(result.sources).toHaveLength(1);
      expect(result.refusalReason).toBeUndefined();
    });

    it('passes a refusal response through unchanged (still HTTP 200 body)', async () => {
      const refusal: ChatbotRagResponse = {
        answer: 'Я не нашёл информации по этому вопросу. Свяжитесь с менеджером через чат «Помощь» — они смогут помочь.',
        hasContext: false,
        sources: [],
        refusalReason: 'no_results',
      };
      const { controller } = buildController({
        askQuestion: jest.fn().mockResolvedValue(refusal) as never,
      });

      const result = await controller.ask({ question: 'Что-то странное' });

      expect(result).toBe(refusal);
      expect(result.refusalReason).toBe('no_results');
      expect(result.hasContext).toBe(false);
    });
  });

  describe('AskChatbotDto validation', () => {
    it('accepts a normal question', async () => {
      const errors = await validate(await buildDto({ question: 'Как оплатить услугу?' }));
      expect(errors).toHaveLength(0);
    });

    it('rejects an empty string', async () => {
      const errors = await validate(await buildDto({ question: '' }));
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].property).toBe('question');
    });

    it('rejects a question longer than 2000 characters', async () => {
      const errors = await validate(await buildDto({ question: 'a'.repeat(2001) }));
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].constraints?.maxLength).toBeDefined();
    });

    it('rejects a non-string value', async () => {
      const dto = new AskChatbotDto();
      (dto as unknown as { question: unknown }).question = 42;
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].constraints?.isString).toBeDefined();
    });
  });
});
