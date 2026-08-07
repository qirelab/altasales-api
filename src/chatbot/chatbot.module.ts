import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AiModule } from '../ai/ai.module';
import { KnowledgeModule } from '../knowledge/knowledge.module';
import { Order } from '../orders/entities/order.entity';
import { ServicePackage } from '../packages/entities/package.entity';
import { Questionnaire } from '../questionnaires/entities/questionnaire.entity';
import { Service } from '../services/entities/service.entity';
import { ChatbotConversationalContextService } from './services/chatbot-conversational-context.service';
import { ChatbotHistorySlicerService } from './services/chatbot-history-slicer.service';
import { ChatbotIntentClassifierService } from './services/chatbot-intent-classifier.service';
import { ChatbotQueryRewriterService } from './services/chatbot-query-rewriter.service';
import { ChatbotRagService } from './services/chatbot-rag.service';
import { ClientContextService } from './services/client-context.service';
import { HandoffTriggerService } from './services/handoff-trigger.service';

@Module({
  imports: [
    AiModule,
    KnowledgeModule,
    TypeOrmModule.forFeature([Questionnaire, Order, Service, ServicePackage]),
  ],
  providers: [
    ChatbotHistorySlicerService,
    ChatbotIntentClassifierService,
    ChatbotQueryRewriterService,
    ChatbotConversationalContextService,
    ChatbotRagService,
    ClientContextService,
    HandoffTriggerService,
  ],
  exports: [
    ChatbotRagService,
    ChatbotConversationalContextService,
    HandoffTriggerService,
  ],
})
export class ChatbotModule {}
