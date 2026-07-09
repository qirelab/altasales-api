import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { KnowledgeModule } from '../knowledge/knowledge.module';
import { ChatbotRagService } from './services/chatbot-rag.service';

@Module({
  imports: [AiModule, KnowledgeModule],
  providers: [ChatbotRagService],
  exports: [ChatbotRagService],
})
export class ChatbotModule {}
