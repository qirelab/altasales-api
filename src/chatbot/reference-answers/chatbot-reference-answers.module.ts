import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AiModule } from '../../ai/ai.module';
import { AuthModule } from '../../auth/auth.module';
import { KnowledgeDocument } from '../../knowledge/entities/knowledge-document.entity';
import { ChatbotReferenceAnswersController } from './chatbot-reference-answers.controller';
import { ChatbotReferenceAnswer } from './entities/chatbot-reference-answer.entity';
import { ChatbotReferenceAnswerIndexerService } from './services/chatbot-reference-answer-indexer.service';
import { ChatbotReferenceAnswerSearchService } from './services/chatbot-reference-answer-search.service';
import { ChatbotReferenceAnswersService } from './services/chatbot-reference-answers.service';
import { ChatbotReferenceInjectionService } from './services/chatbot-reference-injection.service';
import { REFERENCE_ANSWER_VECTOR_STORE } from './vector-store/reference-answer-vector-store.interface';
import { QdrantReferenceAnswerVectorStore } from './vector-store/qdrant-reference-answer-vector-store.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([ChatbotReferenceAnswer, KnowledgeDocument]),
    AuthModule,
    AiModule,
  ],
  controllers: [ChatbotReferenceAnswersController],
  providers: [
    ChatbotReferenceAnswersService,
    ChatbotReferenceAnswerIndexerService,
    ChatbotReferenceAnswerSearchService,
    ChatbotReferenceInjectionService,
    QdrantReferenceAnswerVectorStore,
    {
      provide: REFERENCE_ANSWER_VECTOR_STORE,
      useExisting: QdrantReferenceAnswerVectorStore,
    },
  ],
  exports: [
    ChatbotReferenceAnswersService,
    ChatbotReferenceInjectionService,
  ],
})
export class ChatbotReferenceAnswersModule {}
