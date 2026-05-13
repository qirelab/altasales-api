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
  ],
})
export class AppModule {}
