import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { BalanceTransactionsModule } from '../balance-transactions/balance-transactions.module';
import { RecommendationsModule } from '../recommendations/recommendations.module';
import { RopModule } from '../rop/rop.module';
import { UsersModule } from '../users/users.module';
import { MailModule } from '../mail/mail.module';
import { WebSocketModule } from '../websocket/websocket.module';
import { Questionnaire } from './entities/questionnaire.entity';
import { QuestionnairesService } from './questionnaires.service';
import { QuestionnairesController } from './questionnaires.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([Questionnaire]),
    AuthModule,
    BalanceTransactionsModule,
    WebSocketModule,
    RecommendationsModule,
    RopModule,
    UsersModule,
    MailModule,
  ],
  controllers: [QuestionnairesController],
  providers: [QuestionnairesService],
  exports: [QuestionnairesService],
})
export class QuestionnairesModule {}
