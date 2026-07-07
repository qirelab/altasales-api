import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AiModule } from '../../ai/ai.module';
import { AuthModule } from '../../auth/auth.module';
import { KnowledgeDocument } from '../../knowledge/entities/knowledge-document.entity';
import { ChatbotReferenceAnswersController } from './chatbot-reference-answers.controller';
import { ChatbotReferenceAnswer } from './entities/chatbot-reference-answer.entity';
import { ChatbotReferenceAnswersService } from './services/chatbot-reference-answers.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([ChatbotReferenceAnswer, KnowledgeDocument]),
    AuthModule,
    AiModule,
  ],
  controllers: [ChatbotReferenceAnswersController],
  providers: [ChatbotReferenceAnswersService],
  exports: [ChatbotReferenceAnswersService],
})
export class ChatbotReferenceAnswersModule {}
