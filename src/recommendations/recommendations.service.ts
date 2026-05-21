import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MailService } from '../mail/mail.service';
import { ServiceType } from '../services/entities/service-type.enum';
import { User } from '../users/entities/user.entity';
import { Service } from '../services/entities/service.entity';
import { WebSocketGatewayService } from '../websocket/websocket.gateway';
import { Order } from '../orders/entities/order.entity';
import { CreateAdminRecommendationDto } from './dto/create-admin-recommendation.dto';
import { UpdateAdminRecommendationDto } from './dto/update-admin-recommendation.dto';
import { Recommendation } from './entities/recommendation.entity';
import { RecommendationStatus } from './entities/recommendation-status.enum';

export type UserRecommendationListItem = {
  id: string;
  name: string;
  type: ServiceType;
  category: string;
  price: number;
  status: RecommendationStatus;
};

@Injectable()
export class RecommendationsService {
  private readonly logger = new Logger(RecommendationsService.name);

  constructor(
    @InjectRepository(Recommendation)
    private readonly recommendationRepository: Repository<Recommendation>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(Service)
    private readonly serviceRepository: Repository<Service>,
    @InjectRepository(Order)
    private readonly orderRepository: Repository<Order>,
    private readonly mailService: MailService,
    private readonly websocketGateway: WebSocketGatewayService,
    private readonly configService: ConfigService,
  ) { }

  async findAssignedToUser(userId: string): Promise<Recommendation[]> {
    return this.recommendationRepository
      .createQueryBuilder('recommendation')
      .leftJoinAndSelect('recommendation.service', 'service')
      .leftJoinAndSelect('recommendation.order', 'order')
      .where('recommendation."userId" = :userId', { userId })
      .andWhere('service.type IN (:...serviceTypes)', {
        serviceTypes: [ServiceType.Service, ServiceType.Document],
      })
      .orderBy('recommendation."createdAt"', 'DESC')
      .getMany();
  }

  async findAssignedToUserList(
    userId: string,
  ): Promise<UserRecommendationListItem[]> {
    return this.recommendationRepository
      .createQueryBuilder('recommendation')
      .leftJoin('recommendation.service', 'service')
      .leftJoin('service.category', 'category')
      .select('recommendation.id', 'id')
      .addSelect('service.name', 'name')
      .addSelect('service.type', 'type')
      .addSelect(`COALESCE(category.name, '')`, 'category')
      .addSelect('service.price', 'price')
      .addSelect('recommendation.status', 'status')
      .where('recommendation."userId" = :userId', { userId })
      .andWhere('service.type IN (:...serviceTypes)', {
        serviceTypes: [ServiceType.Service, ServiceType.Document],
      })
      .orderBy('recommendation."createdAt"', 'DESC')
      .getRawMany<UserRecommendationListItem>();
  }

  async findAssignedToUserForAdmin(userId: string): Promise<Recommendation[]> {
    return this.recommendationRepository
      .createQueryBuilder('recommendation')
      .leftJoinAndSelect('recommendation.service', 'service')
      .leftJoinAndSelect('service.category', 'category')
      .leftJoinAndSelect('recommendation.order', 'order')
      .where('recommendation."userId" = :userId', { userId })
      .andWhere('service.type IN (:...serviceTypes)', {
        serviceTypes: [ServiceType.Service, ServiceType.Document],
      })
      .orderBy('recommendation."createdAt"', 'DESC')
      .getMany();
  }

  async createForAdmin(dto: CreateAdminRecommendationDto): Promise<Recommendation> {
    const user = await this.getUserOrThrow(dto.userId);
    await this.ensureServiceCanBeRecommended(dto.serviceId);
    await this.ensureRecommendationIsUnique(dto.userId, dto.serviceId);
    const shouldNotify = await this.shouldNotifyAboutNewRecommendation(user);

    const recommendation = this.recommendationRepository.create({
      userId: dto.userId,
      serviceId: dto.serviceId,
      status: dto.status ?? RecommendationStatus.Recommended,
      orderId: null,
    });

    const saved = await this.recommendationRepository.save(recommendation);

    if (shouldNotify) {
      await this.notifyUserAboutRecommendations(user, saved);
    }

    return saved;
  }

  async markRecommendationsSeen(userId: string): Promise<{ notificationsSeenAt: Date }> {
    const user = await this.getUserOrThrow(userId);
    user.notificationsSeenAt = new Date();
    const savedUser = await this.userRepository.save(user);
    return { notificationsSeenAt: savedUser.notificationsSeenAt! };
  }

  async updateForAdmin(
    id: string,
    dto: UpdateAdminRecommendationDto,
  ): Promise<Recommendation> {
    const recommendation = await this.recommendationRepository.findOne({
      where: { id },
    });

    if (!recommendation) {
      throw new NotFoundException(`Recommendation with id ${id} not found`);
    }

    if (dto.serviceId) {
      await this.ensureServiceCanBeRecommended(dto.serviceId);
      if (dto.serviceId !== recommendation.serviceId) {
        await this.ensureRecommendationIsUnique(
          recommendation.userId,
          dto.serviceId,
          recommendation.id,
        );
      }
      recommendation.serviceId = dto.serviceId;
    }

    if (dto.orderId !== undefined) {
      await this.ensureOrderExists(dto.orderId);
      recommendation.orderId = dto.orderId;
    }

    if (dto.status) {
      recommendation.status = dto.status;
    }

    return this.recommendationRepository.save(recommendation);
  }

  async removeForAdmin(id: string): Promise<void> {
    const result = await this.recommendationRepository.delete({ id });

    if (!result.affected) {
      throw new NotFoundException(`Recommendation with id ${id} not found`);
    }
  }

  private async getUserOrThrow(userId: string): Promise<User> {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException(`User with id ${userId} not found`);
    }
    return user;
  }

  private async shouldNotifyAboutNewRecommendation(user: User): Promise<boolean> {
    const latestRecommendation = await this.recommendationRepository.findOne({
      where: { userId: user.id },
      order: { createdAt: 'DESC' },
    });

    if (!latestRecommendation) {
      return true;
    }

    if (!user.notificationsSeenAt) {
      return false;
    }

    return user.notificationsSeenAt >= latestRecommendation.createdAt;
  }

  private async notifyUserAboutRecommendations(
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
        user.notificationsSeenAt ? { notificationsSeenAt: user.notificationsSeenAt } : {},
      )
      .getCount();

    const clientUrl = this.configService.get<string>('CLIENT_URI', 'http://localhost:3000')
      .split(',')[0]
      .trim();
    const recommendationsUrl = `${clientUrl}/catalog`;

    await this.mailService.sendRecommendationsReadyEmail(
      user.email,
      [user.name, user.lastName].filter(Boolean).join(' '),
      recommendationsUrl,
    );

    this.websocketGateway.emitToUser(user.id, 'recommendations:ready', {
      count: unreadCount,
      createdAt: recommendation.createdAt.toISOString(),
    });

    this.logger.log(`Recommendations ready notification emitted for user ${user.id}`);
  }

  private async ensureServiceCanBeRecommended(serviceId: string): Promise<void> {
    const service = await this.serviceRepository.findOne({
      where: { id: serviceId },
    });
    if (!service) {
      throw new NotFoundException(`Service with id ${serviceId} not found`);
    }

    if (
      service.type !== ServiceType.Service &&
      service.type !== ServiceType.Document
    ) {
      throw new BadRequestException(
        'Only services and documents can be assigned as recommendations',
      );
    }
  }

  private async ensureOrderExists(orderId: string): Promise<void> {
    const order = await this.orderRepository.findOne({
      where: { id: orderId },
    });
    if (!order) {
      throw new NotFoundException(`Order with id ${orderId} not found`);
    }
  }

  private async ensureRecommendationIsUnique(
    userId: string,
    serviceId: string,
    excludeRecommendationId?: string,
  ): Promise<void> {
    const qb = this.recommendationRepository
      .createQueryBuilder('recommendation')
      .where('recommendation."userId" = :userId', { userId })
      .andWhere('recommendation."serviceId" = :serviceId', { serviceId });

    if (excludeRecommendationId) {
      qb.andWhere('recommendation.id != :excludeRecommendationId', {
        excludeRecommendationId,
      });
    }

    const existingRecommendation = await qb.getOne();

    if (existingRecommendation) {
      throw new ConflictException(
        'This service is already recommended to this user',
      );
    }
  }
}
