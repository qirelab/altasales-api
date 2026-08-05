import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AiModule } from '../ai/ai.module';
import { AuthModule } from '../auth/auth.module';
import { FilesModule } from '../files/files.module';
import { ChatbotModule } from '../chatbot/chatbot.module';
import { User } from '../users/entities/user.entity';
import { Order } from '../orders/entities/order.entity';
import { Questionnaire } from '../questionnaires/entities/questionnaire.entity';
import { ChatSession } from './entities/chat-session.entity';
import { ChatMessage } from './entities/chat-message.entity';
import { ChatSessionParticipant } from './entities/chat-session-participant.entity';
import { AdminChatController } from './admin-chat.controller';
import { ExpertChatController } from './expert-chat.controller';
import { ChatService } from './chat.service';
import { ChatController } from './chat.controller';
import { AdminChatService } from './services/admin-chat.service';
import { ExpertChatService } from './services/expert-chat.service';
import { HandoffService } from './services/handoff.service';
import { ChatHistoryMapperService } from './services/chat-history-mapper.service';
import { AiChatOrchestratorService } from './services/ai-chat-orchestrator.service';
import { ChatStreamingService } from './services/chat-streaming.service';
import { SessionTitleService } from './services/session-title.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ChatSession,
      ChatMessage,
      ChatSessionParticipant,
      User,
      Order,
      Questionnaire,
    ]),
    AiModule,
    AuthModule,
    FilesModule,
    ChatbotModule,
  ],
  controllers: [ChatController, AdminChatController, ExpertChatController],
  providers: [
    ChatService,
    AdminChatService,
    ExpertChatService,
    HandoffService,
    ChatHistoryMapperService,
    AiChatOrchestratorService,
    ChatStreamingService,
    SessionTitleService,
  ],
  exports: [ChatService, AdminChatService, ExpertChatService],
})
export class ChatModule {}
