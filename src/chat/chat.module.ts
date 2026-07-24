import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { FilesModule } from '../files/files.module';
import { ChatbotModule } from '../chatbot/chatbot.module';
import { User } from '../users/entities/user.entity';
import { Order } from '../orders/entities/order.entity';
import { ChatConversation } from './entities/chat-conversation.entity';
import { ChatMessage } from './entities/chat-message.entity';
import { ChatConversationParticipant } from './entities/chat-conversation-participant.entity';
import { ChatService } from './chat.service';
import { ChatController } from './chat.controller';
import { ChatHistoryMapperService } from './services/chat-history-mapper.service';
import { AiChatOrchestratorService } from './services/ai-chat-orchestrator.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ChatConversation,
      ChatMessage,
      ChatConversationParticipant,
      User,
      Order,
    ]),
    AuthModule,
    FilesModule,
    ChatbotModule,
  ],
  controllers: [ChatController],
  providers: [ChatService, ChatHistoryMapperService, AiChatOrchestratorService],
  exports: [ChatService],
})
export class ChatModule {}
