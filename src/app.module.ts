import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { UsersModule } from './users/users.module';
import { DatabaseModule } from './config/database.module.js';
import { AuthModule } from './auth/auth.module';
import { ServicesModule } from './services/services.module';
import { PaymentModule } from './payment/payment.module';
import { OrdersModule } from './orders/orders.module';
import { WebSocketModule } from './websocket/websocket.module.js';
import { ChatModule } from './chat/chat.module';
import { QuestionnairesModule } from './questionnaires/questionnaires.module';
import { FilesModule } from './files/files.module';
import { CartModule } from './cart/cart.module';
import { RecommendationsModule } from './recommendations/recommendations.module';
import { AiModule } from './ai/ai.module';
import { MailModule } from './mail/mail.module';
import { KnowledgeModule } from './knowledge/knowledge.module';
import { PackagesModule } from './packages/packages.module';
import { CategoriesModule } from './categories/categories.module';
import { TranscriptionModule } from './transcription/transcription.module';
import { CatalogStorageModule } from './catalog-storage/catalog-storage.module';
import { ChatbotModule } from './chatbot/chatbot.module';
import { ExpertsModule } from './experts/experts.module';
import { FeedbackModule } from './feedback/feedback.module';
import { ChatbotReferenceAnswersModule } from './chatbot/reference-answers/chatbot-reference-answers.module';

@Module({
  imports: [
    UsersModule,
    DatabaseModule,
    ConfigModule.forRoot({ isGlobal: true }),
    AuthModule,
    ServicesModule,
    PaymentModule,
    OrdersModule,
    WebSocketModule,
    ChatModule,
    QuestionnairesModule,
    FilesModule,
    CartModule,
    RecommendationsModule,
    AiModule,
    MailModule,
    KnowledgeModule,
    PackagesModule,
    CategoriesModule,
    TranscriptionModule,
    CatalogStorageModule,
    ChatbotModule,
    ExpertsModule,
    FeedbackModule,
    ChatbotReferenceAnswersModule,
  ],
})
export class AppModule {}
