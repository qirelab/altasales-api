import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, Repository } from 'typeorm';
import { MailService } from '../mail/mail.service';
import { ServiceType } from '../services/entities/service-type.enum';
import { User } from '../users/entities/user.entity';
import { Service } from '../services/entities/service.entity';
import { ServicePackage } from '../packages/entities/package.entity';
import { WebSocketGatewayService } from '../websocket/websocket.gateway';
import { Order } from '../orders/entities/order.entity';
import { CreateAdminRecommendationDto } from './dto/create-admin-recommendation.dto';
import { UpdateAdminRecommendationDto } from './dto/update-admin-recommendation.dto';
import { Recommendation } from './entities/recommendation.entity';
import { RecommendationStatus } from './entities/recommendation-status.enum';

export type PackageInnerServiceItem = {
  id: string;
  name: string;
  type: ServiceType;
  price: number;
};

export type UserRecommendationListItem = {
  id: string;
  serviceId: string | null;
  packageId: string | null;
  name: string;
  type: ServiceType | 'Пакет услуг';
  category: string;
  price: number;
  status: RecommendationStatus;
  createdAt: Date;
  services?: PackageInnerServiceItem[];
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
    @InjectRepository(ServicePackage)
    private readonly packageRepository: Repository<ServicePackage>,
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
      .leftJoinAndSelect('recommendation.package', 'package')
      .leftJoinAndSelect('package.category', 'packageCategory')
      .leftJoinAndSelect('recommendation.order', 'order')
      .where('recommendation."userId" = :userId', { userId })
      .andWhere(new Brackets((qb) => {
        qb
          .where('service.type IN (:...serviceTypes)', {
            serviceTypes: [ServiceType.Service, ServiceType.Document],
          })
          .orWhere('package.id IS NOT NULL');
      }))
      .orderBy('recommendation."createdAt"', 'DESC')
      .getMany();
  }

  async findAssignedToUserList(
    userId: string,
  ): Promise<UserRecommendationListItem[]> {
    const rows = await this.recommendationRepository
      .createQueryBuilder('recommendation')
      .leftJoin('recommendation.service', 'service')
      .leftJoin('service.category', 'serviceCategory')
      .leftJoin('recommendation.package', 'package')
      .leftJoin('package.category', 'packageCategory')
      .select('recommendation.id', 'id')
      .addSelect('recommendation."serviceId"', 'serviceId')
      .addSelect('recommendation."packageId"', 'packageId')
      .addSelect('COALESCE(service.name, package.name)', 'name')
      .addSelect(`COALESCE(service.type, 'Пакет услуг')`, 'type')
      .addSelect('COALESCE(serviceCategory.name, packageCategory.name, \'\')', 'category')
      .addSelect('COALESCE(service.price, package.price)', 'price')
      .addSelect('recommendation.status', 'status')
      .addSelect('recommendation."createdAt"', 'createdAt')
      .where('recommendation."userId" = :userId', { userId })
      .andWhere(new Brackets((qb) => {
        qb
          .where('service.type IN (:...serviceTypes)', {
            serviceTypes: [ServiceType.Service, ServiceType.Document],
          })
          .orWhere('package.id IS NOT NULL');
      }))
      .orderBy('recommendation."createdAt"', 'DESC')
      .getRawMany<UserRecommendationListItem>();

    const packageIds = rows
      .filter((row) => row.packageId)
      .map((row) => row.packageId as string);

    if (packageIds.length === 0) {
      return rows;
    }

    const packagesWithServices = await this.packageRepository.find({
      where: packageIds.map((id) => ({ id })),
      relations: ['services'],
    });
    const innerServicesByPackageId = new Map<string, PackageInnerServiceItem[]>();
    packagesWithServices.forEach((pkg) => {
      innerServicesByPackageId.set(
        pkg.id,
        (pkg.services ?? []).map((service) => ({
          id: service.id,
          name: service.name,
          type: service.type,
          price: Number(service.price),
        })),
      );
    });

    return rows.map((row) => (
      row.packageId
        ? { ...row, services: innerServicesByPackageId.get(row.packageId) ?? [] }
        : row
    ));
  }

  async findAssignedToUserForAdmin(userId: string): Promise<Recommendation[]> {
    return this.recommendationRepository
      .createQueryBuilder('recommendation')
      .leftJoinAndSelect('recommendation.service', 'service')
      .leftJoinAndSelect('service.category', 'serviceCategory')
      .leftJoinAndSelect('recommendation.package', 'package')
      .leftJoinAndSelect('package.category', 'packageCategory')
      .leftJoinAndSelect('recommendation.order', 'order')
      .where('recommendation."userId" = :userId', { userId })
      .andWhere(new Brackets((qb) => {
        qb
          .where('service.type IN (:...serviceTypes)', {
            serviceTypes: [ServiceType.Service, ServiceType.Document],
          })
          .orWhere('package.id IS NOT NULL');
      }))
      .orderBy('recommendation."createdAt"', 'DESC')
      .getMany();
  }

  async createForAdmin(dto: CreateAdminRecommendationDto): Promise<Recommendation> {
    const user = await this.getUserOrThrow(dto.userId);
    const target = await this.resolveAndValidateRecommendationTarget(dto.serviceId, dto.packageId);
    await this.ensureRecommendationIsUnique(dto.userId, target.serviceId, target.packageId);
    const shouldNotify = await this.shouldNotifyAboutNewRecommendation(user);

    const recommendation = this.recommendationRepository.create({
      userId: dto.userId,
      serviceId: target.serviceId,
      packageId: target.packageId,
      status: dto.status ?? RecommendationStatus.Recommended,
      orderId: null,
    });

    const saved = await this.recommendationRepository.save(recommendation);

    if (shouldNotify) {
      await this.notifyUserAboutRecommendations(user, saved);
    }

    return this.findRecommendationWithRelationsOrThrow(saved.id);
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

    const shouldUpdateTarget = dto.serviceId !== undefined || dto.packageId !== undefined;
    if (shouldUpdateTarget) {
      const target = await this.resolveUpdateRecommendationTarget(dto);
      const changedTarget = target.serviceId !== recommendation.serviceId
        || target.packageId !== recommendation.packageId;

      if (changedTarget) {
        await this.ensureRecommendationIsUnique(
          recommendation.userId,
          target.serviceId,
          target.packageId,
          recommendation.id,
        );
      }

      recommendation.serviceId = target.serviceId;
      recommendation.packageId = target.packageId;
    }

    if (dto.orderId !== undefined) {
      await this.ensureOrderExists(dto.orderId);
      recommendation.orderId = dto.orderId;
    }

    if (dto.status) {
      recommendation.status = dto.status;
    }

    const saved = await this.recommendationRepository.save(recommendation);
    return this.findRecommendationWithRelationsOrThrow(saved.id);
  }

  private async resolveUpdateRecommendationTarget(
    dto: UpdateAdminRecommendationDto,
  ): Promise<{ serviceId: string | null; packageId: string | null }> {
    const hasService = dto.serviceId !== undefined;
    const hasPackage = dto.packageId !== undefined;

    if (hasService && hasPackage) {
      return this.resolveAndValidateRecommendationTarget(dto.serviceId, dto.packageId);
    }
    if (hasService) {
      return this.resolveAndValidateRecommendationTarget(dto.serviceId, undefined);
    }
    return this.resolveAndValidateRecommendationTarget(undefined, dto.packageId);
  }

  private async findRecommendationWithRelationsOrThrow(id: string): Promise<Recommendation> {
    const recommendation = await this.recommendationRepository.findOne({
      where: { id },
      relations: ['service', 'service.category', 'package', 'package.category', 'order'],
    });
    if (!recommendation) {
      throw new NotFoundException(`Recommendation with id ${id} not found`);
    }
    return recommendation;
  }

  private async resolveAndValidateRecommendationTarget(
    serviceId?: string,
    packageId?: string,
  ): Promise<{ serviceId: string | null; packageId: string | null }> {
    const hasService = Boolean(serviceId);
    const hasPackage = Boolean(packageId);
    if (hasService === hasPackage) {
      throw new BadRequestException('Exactly one of serviceId or packageId must be provided');
    }

    if (serviceId) {
      await this.ensureServiceCanBeRecommended(serviceId);
      return { serviceId, packageId: null };
    }

    await this.ensurePackageCanBeRecommended(packageId!);
    return { serviceId: null, packageId: packageId! };
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

  private async ensurePackageCanBeRecommended(packageId: string): Promise<void> {
    const servicePackage = await this.packageRepository.findOne({
      where: { id: packageId },
    });
    if (!servicePackage) {
      throw new NotFoundException(`Package with id ${packageId} not found`);
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
    serviceId: string | null,
    packageId: string | null,
    excludeRecommendationId?: string,
  ): Promise<void> {
    const qb = this.recommendationRepository
      .createQueryBuilder('recommendation')
      .where('recommendation."userId" = :userId', { userId });

    if (serviceId) {
      qb.andWhere('recommendation."serviceId" = :serviceId', { serviceId });
    } else if (packageId) {
      qb.andWhere('recommendation."packageId" = :packageId', { packageId });
    }

    if (excludeRecommendationId) {
      qb.andWhere('recommendation.id != :excludeRecommendationId', {
        excludeRecommendationId,
      });
    }

    const existingRecommendation = await qb.getOne();

    if (existingRecommendation) {
      throw new ConflictException(
        serviceId
          ? 'This service is already recommended to this user'
          : 'This package is already recommended to this user',
      );
    }
  }
}
