import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MailService } from '../mail/mail.service';
import { User } from '../users/entities/user.entity';
import { WebSocketGatewayService } from '../websocket/websocket.gateway';
import { Recommendation } from './entities/recommendation.entity';

@Injectable()
export class RecommendationNotificationService {
  private readonly logger = new Logger(RecommendationNotificationService.name);

  constructor(
    @InjectRepository(Recommendation)
    private readonly recommendationRepository: Repository<Recommendation>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly mailService: MailService,
    private readonly websocketGateway: WebSocketGatewayService,
    private readonly configService: ConfigService,
  ) {}

  async markSeen(user: User): Promise<{ notificationsSeenAt: Date }> {
    user.notificationsSeenAt = new Date();
    const savedUser = await this.userRepository.save(user);
    return { notificationsSeenAt: savedUser.notificationsSeenAt! };
  }

  async shouldNotifyAboutNewRecommendation(user: User): Promise<boolean> {
    const latestRecommendation = await this.recommendationRepository.findOne({
      where: { userId: user.id },
      order: { createdAt: 'DESC' },
    });
    if (!latestRecommendation) return true;
    if (!user.notificationsSeenAt) return false;
    return user.notificationsSeenAt >= latestRecommendation.createdAt;
  }

  async notifyUserAboutRecommendations(
    user: User,
    recommendation: Recommendation,
  ): Promise<void> {
    const unreadCount = await this.recommendationRepository
      .createQueryBuilder('recommendation')
      .where('recommendation."userId" = :userId', { userId: user.id })
      .andWhere(
        user.notificationsSeenAt
          ? 'recommendation."createdAt" > :notificationsSeenAt'
          : '1=1',
        user.notificationsSeenAt
          ? { notificationsSeenAt: user.notificationsSeenAt }
          : {},
      )
      .getCount();

    const clientUrl = this.configService
      .get<string>('CLIENT_URI', 'http://localhost:3000')
      .split(',')[0]
      .trim();
    const recommendationsUrl = `${clientUrl}/profile?tab=3`;

    await this.mailService.sendRecommendationsReadyEmail(
      user.email,
      [user.name, user.lastName].filter(Boolean).join(' '),
      recommendationsUrl,
    );

    this.websocketGateway.emitToUser(user.id, 'recommendations:ready', {
      count: unreadCount,
      createdAt: recommendation.createdAt.toISOString(),
    });

    this.logger.log(
      `Recommendations ready notification emitted for user ${user.id}`,
    );
  }
}
