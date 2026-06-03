import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AiModule } from '../ai/ai.module';
import { AuthModule } from '../auth/auth.module';
import { MailModule } from '../mail/mail.module';
import { Order } from '../orders/entities/order.entity';
import { ServicePackage } from '../packages/entities/package.entity';
import { Service } from '../services/entities/service.entity';
import { User } from '../users/entities/user.entity';
import { WebSocketModule } from '../websocket/websocket.module';
import { RecommendationGenerationJob } from './entities/recommendation-generation-job.entity';
import { Recommendation } from './entities/recommendation.entity';
import { RecommendationGenerationJobService } from './recommendation-generation-job.service';
import { RecommendationNotificationService } from './recommendation-notification.service';
import { RecommendationScoringService } from './recommendation-scoring.service';
import { QuestionnaireRelevanceRankerService } from './questionnaire-relevance-ranker.service';
import { RecommendationsController } from './recommendations.controller';
import { RecommendationsService } from './recommendations.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Recommendation,
      RecommendationGenerationJob,
      User,
      Service,
      ServicePackage,
      Order,
    ]),
    AiModule,
    AuthModule,
    ConfigModule,
    MailModule,
    WebSocketModule,
  ],
  controllers: [RecommendationsController],
  providers: [
    RecommendationsService,
    RecommendationScoringService,
    QuestionnaireRelevanceRankerService,
    RecommendationGenerationJobService,
    RecommendationNotificationService,
  ],
  exports: [RecommendationsService],
})
export class RecommendationsModule {}
