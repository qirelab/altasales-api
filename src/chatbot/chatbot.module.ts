import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { AuthModule } from '../auth/auth.module';
import { KnowledgeModule } from '../knowledge/knowledge.module';
import { ChatbotController } from './chatbot.controller';
import { ChatbotReferenceAnswersModule } from './reference-answers/chatbot-reference-answers.module';
import { ChatbotRagService } from './services/chatbot-rag.service';

@Module({
  imports: [AiModule, AuthModule, KnowledgeModule, ChatbotReferenceAnswersModule],
  controllers: [ChatbotController],
  providers: [ChatbotRagService],
  exports: [ChatbotRagService],
})
export class ChatbotModule {}
