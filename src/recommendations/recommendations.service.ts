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
import { GenerateRecommendationsDto } from './dto/generate-recommendations.dto';
import { UpdateAdminRecommendationDto } from './dto/update-admin-recommendation.dto';
import { RecommendationPriority } from './entities/recommendation-priority.enum';
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
  priority: RecommendationPriority;
  rationale: string | null;
  dependencyIds: string[];
  diagnosticSignals: string[];
};

export type AdminRecommendationListItem = {
  id: string;
  serviceId: string;
  category: string;
  status: RecommendationStatus;
  priority: RecommendationPriority;
  price: number;
  rationale: string | null;
  dependencyIds: string[];
};

export type GeneratedRecommendationItem = {
  serviceId: string;
  serviceName: string;
  rationale: string;
  diagnosticSignals: string[];
  score: number;
  priority: RecommendationPriority;
  recommendation?: Recommendation;
};

type ServiceCandidate = Service & {
  category?: { name?: string } | null;
};

type SignalGroup = {
  signal: string;
  weight: number;
  terms: string[];
};

const SIGNAL_GROUPS: SignalGroup[] = [
  {
    signal: 'revenue_risk',
    weight: 5,
    terms: [
      'revenue',
      'plan',
      'money',
      'profit',
      'risk',
      'loss',
      'sales target',
      'выруч',
      'прибыл',
      'потер',
    ],
  },
  {
    signal: 'funnel_conversion',
    weight: 4,
    terms: [
      'conversion',
      'funnel',
      'lead',
      'deal',
      'drop-off',
      'конверс',
      'воронк',
      'лид',
      'сделк',
    ],
  },
  {
    signal: 'crm_quality',
    weight: 3,
    terms: [
      'crm',
      'data',
      'duplicate',
      'status',
      'task',
      'данн',
      'дубл',
      'статус',
      'задач',
    ],
  },
  {
    signal: 'team_performance',
    weight: 3,
    terms: [
      'manager',
      'team',
      'discipline',
      'kpi',
      'script',
      'менедж',
      'команд',
      'дисциплин',
      'скрипт',
    ],
  },
  {
    signal: 'sales_process',
    weight: 2,
    terms: [
      'process',
      'training',
      'document',
      'control',
      'регламент',
      'процесс',
      'обуч',
      'документ',
      'контрол',
    ],
  },
];

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
      .orderBy(this.priorityOrderExpression(), 'ASC')
      .addOrderBy('recommendation."createdAt"', 'DESC')
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
      .addSelect('recommendation.priority', 'priority')
      .addSelect('recommendation.rationale', 'rationale')
      .addSelect('recommendation."dependencyIds"', 'dependencyIds')
      .addSelect('recommendation."diagnosticSignals"', 'diagnosticSignals')
      .where('recommendation."userId" = :userId', { userId })
      .andWhere('service.type IN (:...serviceTypes)', {
        serviceTypes: [ServiceType.Service, ServiceType.Document],
      })
      .orderBy(this.priorityOrderExpression(), 'ASC')
      .addOrderBy('recommendation."createdAt"', 'DESC')
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
      .addSelect('recommendation.priority', 'priority')
      .addSelect('service.price', 'price')
      .addSelect('recommendation.rationale', 'rationale')
      .addSelect('recommendation."dependencyIds"', 'dependencyIds')
      .where('recommendation."userId" = :userId', { userId })
      .andWhere('service.type IN (:...serviceTypes)', {
        serviceTypes: [ServiceType.Service, ServiceType.Document],
      })
      .orderBy(this.priorityOrderExpression(), 'ASC')
      .addOrderBy('recommendation."createdAt"', 'DESC')
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
      priority: dto.priority ?? RecommendationPriority.Medium,
      rationale: dto.rationale ?? null,
      dependencyIds: this.uniqueIds(dto.dependencyIds ?? []),
      diagnosticSignals: this.normalizeSignals(dto.diagnosticSignals ?? []),
      generatedAt: null,
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
    if (dto.priority) recommendation.priority = dto.priority;
    if (dto.rationale !== undefined) recommendation.rationale = dto.rationale;

    if (dto.dependencyIds) {
      recommendation.dependencyIds = await this.validateDependencyIds(
        recommendation.id,
        dto.dependencyIds,
      );
    }

    if (dto.diagnosticSignals) {
      recommendation.diagnosticSignals = this.normalizeSignals(
        dto.diagnosticSignals,
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

  async generateForUser(
    dto: GenerateRecommendationsDto,
  ): Promise<GeneratedRecommendationItem[]> {
    await this.ensureUserExists(dto.userId);

    const limit = dto.limit ?? 5;
    const services = await this.findRecommendableServices();
    const context = this.buildDiagnosticContext(dto);
    const ranked = services
      .map((service) => this.scoreService(service, context))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    if (dto.persist === false) {
      return ranked;
    }

    const persisted: GeneratedRecommendationItem[] = [];

    for (const item of ranked) {
      const recommendation = await this.upsertGeneratedRecommendation(
        dto.userId,
        item,
      );
      persisted.push({ ...item, recommendation });
    }

    return persisted;
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

  private async findRecommendableServices(): Promise<ServiceCandidate[]> {
    return this.serviceRepository
      .createQueryBuilder('service')
      .leftJoinAndSelect('service.category', 'category')
      .where('service.type IN (:...serviceTypes)', {
        serviceTypes: [ServiceType.Service, ServiceType.Document],
      })
      .getMany() as Promise<ServiceCandidate[]>;
  }

  private scoreService(
    service: ServiceCandidate,
    context: string,
  ): GeneratedRecommendationItem {
    const serviceText = this.normalizeText(
      [
        service.name,
        service.description,
        service.category?.name,
        ...(service.skills ?? []),
        ...(service.contentSections ?? []).map(
          (section) => `${section.title} ${section.content}`,
        ),
      ].join(' '),
    );
    const matchedSignals = SIGNAL_GROUPS.filter(
      (group) =>
        group.terms.some((term) => context.includes(term)) &&
        group.terms.some((term) => serviceText.includes(term)),
    );
    const score = matchedSignals.reduce((sum, group) => sum + group.weight, 0);

    return {
      serviceId: service.id,
      serviceName: service.name,
      rationale: this.buildRationale(service.name, matchedSignals),
      diagnosticSignals: matchedSignals.map((group) => group.signal),
      score,
      priority: this.resolvePriority(score, matchedSignals),
    };
  }

  private async upsertGeneratedRecommendation(
    userId: string,
    item: GeneratedRecommendationItem,
  ): Promise<Recommendation> {
    const existing = await this.recommendationRepository.findOne({
      where: { userId, serviceId: item.serviceId },
    });

    if (existing) {
      existing.rationale = item.rationale;
      existing.diagnosticSignals = item.diagnosticSignals;
      existing.priority = item.priority;
      existing.generatedAt = new Date();

      return this.recommendationRepository.save(existing);
    }

    const recommendation = this.recommendationRepository.create({
      userId,
      serviceId: item.serviceId,
      status: RecommendationStatus.Recommended,
      priority: item.priority,
      rationale: item.rationale,
      dependencyIds: [],
      diagnosticSignals: item.diagnosticSignals,
      generatedAt: new Date(),
      orderId: null,
    });

    return this.recommendationRepository.save(recommendation);
  }

  private resolvePriority(
    score: number,
    matchedSignals: { signal: string }[],
  ): RecommendationPriority {
    const signals = matchedSignals.map((group) => group.signal);
    const revenueOrFunnelRisk =
      signals.includes('revenue_risk') || signals.includes('funnel_conversion');

    if (score >= 8 || (score >= 5 && revenueOrFunnelRisk)) {
      return RecommendationPriority.Urgent;
    }

    if (score >= 3) {
      return RecommendationPriority.Medium;
    }

    return RecommendationPriority.Low;
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

  private buildRationale(
    serviceName: string,
    matchedSignals: { signal: string }[],
  ): string {
    const signalText = matchedSignals.map((group) => group.signal).join(', ');

    return `${serviceName} matched diagnostics (${signalText || 'general fit'}).`;
  }

  private buildDiagnosticContext(dto: GenerateRecommendationsDto): string {
    return this.normalizeText(
      [
        JSON.stringify(dto.clientProfile ?? {}),
        ...(dto.diagnostics ?? []),
      ].join(' '),
    );
  }

  private normalizeText(text: string): string {
    return text.toLowerCase().replace(/ё/g, 'е');
  }

  private normalizeSignals(signals: string[]): string[] {
    return Array.from(
      new Set(
        signals
          .map((signal) => signal.trim())
          .filter((signal) => signal.length > 0),
      ),
    );
  }

  private priorityOrderExpression(): string {
    return `CASE recommendation.priority WHEN '${RecommendationPriority.Urgent}' THEN 1 WHEN '${RecommendationPriority.Medium}' THEN 2 ELSE 3 END`;
  }

  private uniqueIds(ids: string[]): string[] {
    return Array.from(new Set(ids));
  }
}
