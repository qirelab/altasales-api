import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Order } from '../orders/entities/order.entity';
import { Service } from '../services/entities/service.entity';
import { ServiceType } from '../services/entities/service-type.enum';
import { User } from '../users/entities/user.entity';
import { CreateAdminRecommendationDto } from './dto/create-admin-recommendation.dto';
import { UpdateAdminRecommendationDto } from './dto/update-admin-recommendation.dto';
import { RecommendationStatus } from './entities/recommendation-status.enum';
import { Recommendation } from './entities/recommendation.entity';

export type UserRecommendationListItem = {
  id: string;
  serviceId: string;
  name: string;
  type: ServiceType;
  category: string;
  price: number;
  status: RecommendationStatus;
  dependencyIds: string[];
};

export type AdminRecommendationListItem = {
  id: string;
  serviceId: string;
  category: string;
  status: RecommendationStatus;
  price: number;
  dependencyIds: string[];
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
  ) {}

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
      .addSelect('recommendation."serviceId"', 'serviceId')
      .addSelect('service.name', 'name')
      .addSelect('service.type', 'type')
      .addSelect(`COALESCE(category.name, '')`, 'category')
      .addSelect('service.price', 'price')
      .addSelect('recommendation.status', 'status')
      .addSelect('recommendation."dependencyIds"', 'dependencyIds')
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
      .leftJoin('service.category', 'category')
      .select('recommendation.id', 'id')
      .addSelect('recommendation."serviceId"', 'serviceId')
      .addSelect(`COALESCE(category.name, '')`, 'category')
      .addSelect('recommendation.status', 'status')
      .addSelect('service.price', 'price')
      .addSelect('recommendation."dependencyIds"', 'dependencyIds')
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
    await this.ensureRecommendationIsUnique(dto.userId, dto.serviceId);
    await this.ensureDependencyGraphIsValid(dto.dependencyIds ?? []);

    const recommendation = this.recommendationRepository.create({
      userId: dto.userId,
      serviceId: dto.serviceId,
      status: dto.status ?? RecommendationStatus.Recommended,
      dependencyIds: this.uniqueIds(dto.dependencyIds ?? []),
      orderId: null,
    });

    return this.recommendationRepository.save(recommendation);
  }

  async updateForAdmin(
    id: string,
    dto: UpdateAdminRecommendationDto,
  ): Promise<Recommendation> {
    const recommendation = await this.getRecommendationOrThrow(id);

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

    if (dto.status) recommendation.status = dto.status;

    if (dto.dependencyIds) {
      recommendation.dependencyIds = await this.validateDependencyIds(
        recommendation.id,
        dto.dependencyIds,
      );
    }

    return this.recommendationRepository.save(recommendation);
  }

  async updateDependenciesForAdmin(
    id: string,
    dependencyIds: string[],
  ): Promise<Recommendation> {
    const recommendation = await this.getRecommendationOrThrow(id);
    recommendation.dependencyIds = await this.validateDependencyIds(
      recommendation.id,
      dependencyIds,
    );

    return this.recommendationRepository.save(recommendation);
  }

  async removeForAdmin(id: string): Promise<void> {
    const result = await this.recommendationRepository.delete({ id });

    if (!result.affected) {
      throw new NotFoundException(`Recommendation with id ${id} not found`);
    }
  }

  private async getRecommendationOrThrow(id: string): Promise<Recommendation> {
    const recommendation = await this.recommendationRepository.findOne({
      where: { id },
    });

    if (!recommendation) {
      throw new NotFoundException(`Recommendation with id ${id} not found`);
    }

    return recommendation;
  }

  private async validateDependencyIds(
    recommendationId: string,
    dependencyIds: string[],
  ): Promise<string[]> {
    const uniqueDependencyIds = this.uniqueIds(dependencyIds);

    if (uniqueDependencyIds.includes(recommendationId)) {
      throw new BadRequestException('Recommendation cannot depend on itself');
    }

    await this.ensureDependencyGraphIsValid(uniqueDependencyIds);

    return uniqueDependencyIds;
  }

  private async ensureDependencyGraphIsValid(
    dependencyIds: string[],
  ): Promise<void> {
    const uniqueDependencyIds = this.uniqueIds(dependencyIds);

    if (uniqueDependencyIds.length === 0) return;

    const dependencies = await this.recommendationRepository.find({
      where: { id: In(uniqueDependencyIds) },
      select: { id: true },
    });

    if (dependencies.length !== uniqueDependencyIds.length) {
      throw new BadRequestException('One or more dependency IDs do not exist');
    }
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

  private uniqueIds(ids: string[]): string[] {
    return Array.from(new Set(ids));
  }
}
