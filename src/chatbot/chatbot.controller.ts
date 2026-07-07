import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { SessionGuard } from '../auth/guards/session.guard';
import { AskChatbotDto } from './dto/ask-chatbot.dto';
import { ChatbotRagResponse, ChatbotRagService } from './services/chatbot-rag.service';

@ApiTags('chatbot')
@ApiCookieAuth('session')
@UseGuards(SessionGuard)
@Controller('chatbot')
export class ChatbotController {
  constructor(private readonly chatbotRag: ChatbotRagService) {}

  @Post('ask')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Ask the RAG chatbot a question',
    description:
      'Runs the full RAG pipeline: retrieval → augmentation → LLM. '
      + 'Always returns 200 with a normalized response — refusals travel in the '
      + 'body (`refusalReason` + neutral copy in `answer`) rather than as HTTP errors.',
  })
  @ApiResponse({ status: 200, description: 'Answer, sources and optional refusal reason.' })
  @ApiResponse({ status: 400, description: 'Question missing or exceeds 2000 characters.' })
  @ApiResponse({ status: 401, description: 'Unauthenticated.' })
  async ask(@Body() dto: AskChatbotDto): Promise<ChatbotRagResponse> {
    return this.chatbotRag.askQuestion({ question: dto.question });
  }
}
