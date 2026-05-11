import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ServiceType } from '../services/entities/service-type.enum';
import { User } from '../users/entities/user.entity';
import { Service } from '../services/entities/service.entity';
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

export type AdminRecommendationListItem = {
  id: string;
  category: string;
  status: RecommendationStatus;
  price: number;
};

@Injectable()
export class RecommendationsService {
  constructor(
    @InjectRepository(Recommendation)
    private readonly recommendationRepository: Repository<Recommendation>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(Service)
    private readonly serviceRepository: Repository<Service>,
    @InjectRepository(Order)
    private readonly orderRepository: Repository<Order>,
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
      .select('recommendation.id', 'id')
      .addSelect('service.name', 'name')
      .addSelect('service.type', 'type')
      .addSelect('service.category', 'category')
      .addSelect('service.price', 'price')
      .addSelect('recommendation.status', 'status')
      .where('recommendation."userId" = :userId', { userId })
      .andWhere('service.type IN (:...serviceTypes)', {
        serviceTypes: [ServiceType.Service, ServiceType.Document],
      })
      .orderBy('recommendation."createdAt"', 'DESC')
      .getRawMany<UserRecommendationListItem>();
  }

  async findAssignedToUserForAdmin(
    userId: string,
  ): Promise<AdminRecommendationListItem[]> {
    return this.recommendationRepository
      .createQueryBuilder('recommendation')
      .leftJoin('recommendation.service', 'service')
      .select('recommendation.id', 'id')
      .addSelect('service.category', 'category')
      .addSelect('recommendation.status', 'status')
      .addSelect('service.price', 'price')
      .where('recommendation."userId" = :userId', { userId })
      .andWhere('service.type IN (:...serviceTypes)', {
        serviceTypes: [ServiceType.Service, ServiceType.Document],
      })
      .orderBy('recommendation."createdAt"', 'DESC')
      .getRawMany<AdminRecommendationListItem>();
  }

  async createForAdmin(dto: CreateAdminRecommendationDto): Promise<Recommendation> {
    await this.ensureUserExists(dto.userId);
    await this.ensureServiceCanBeRecommended(dto.serviceId);

    const recommendation = this.recommendationRepository.create({
      userId: dto.userId,
      serviceId: dto.serviceId,
      status: dto.status ?? RecommendationStatus.Recommended,
      orderId: null,
    });

    return this.recommendationRepository.save(recommendation);
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

  private async ensureUserExists(userId: string): Promise<void> {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException(`User with id ${userId} not found`);
    }
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
}
