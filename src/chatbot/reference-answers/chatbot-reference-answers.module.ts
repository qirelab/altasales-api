import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AiModule } from '../../ai/ai.module';
import { AuthModule } from '../../auth/auth.module';
import { KnowledgeDocument } from '../../knowledge/entities/knowledge-document.entity';
import { KnowledgeModule } from '../../knowledge/knowledge.module';
import { ChatbotReferenceAnswersController } from './chatbot-reference-answers.controller';
import { ChatbotReferenceAnswer } from './entities/chatbot-reference-answer.entity';
import { ChatbotReferenceAnswersService } from './services/chatbot-reference-answers.service';
import { ReferenceAnswerPublisherService } from './services/reference-answer-publisher.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([ChatbotReferenceAnswer, KnowledgeDocument]),
    AuthModule,
    AiModule,
    KnowledgeModule,
  ],
  controllers: [ChatbotReferenceAnswersController],
  providers: [ChatbotReferenceAnswersService, ReferenceAnswerPublisherService],
  exports: [ChatbotReferenceAnswersService],
})
export class ChatbotReferenceAnswersModule {}
