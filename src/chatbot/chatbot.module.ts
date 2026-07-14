import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { KnowledgeModule } from '../knowledge/knowledge.module';
import { ChatbotConversationalContextService } from './services/chatbot-conversational-context.service';
import { ChatbotHistorySlicerService } from './services/chatbot-history-slicer.service';
import { ChatbotQueryRewriterService } from './services/chatbot-query-rewriter.service';
import { ChatbotRagService } from './services/chatbot-rag.service';

@Module({
  imports: [AiModule, KnowledgeModule],
  providers: [
    ChatbotHistorySlicerService,
    ChatbotQueryRewriterService,
    ChatbotConversationalContextService,
    ChatbotRagService,
  ],
  exports: [
    ChatbotRagService,
    ChatbotConversationalContextService,
  ],
})
export class ChatbotModule {}
