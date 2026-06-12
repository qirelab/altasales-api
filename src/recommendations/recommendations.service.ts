import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, IsNull, Repository } from 'typeorm';
import { Order } from '../orders/entities/order.entity';
import { ServicePackage } from '../packages/entities/package.entity';
import { Service } from '../services/entities/service.entity';
import { activePackageWhere } from '../packages/package-visibility';
import { filterActiveServices } from '../services/service-visibility';
import { ServiceType } from '../services/entities/service-type.enum';
import { Questionnaire } from '../questionnaires/entities/questionnaire.entity';
import { User } from '../users/entities/user.entity';
import { CreateAdminRecommendationDto } from './dto/create-admin-recommendation.dto';
import { GenerateRecommendationsDto } from './dto/generate-recommendations.dto';
import { UpdateAdminRecommendationDto } from './dto/update-admin-recommendation.dto';
import { UpdateUserRecommendationDto } from './dto/update-user-recommendation.dto';
import { RecommendationGenerationJob } from './entities/recommendation-generation-job.entity';
import { RecommendationPriority } from './entities/recommendation-priority.enum';
import { RecommendationStatus } from './entities/recommendation-status.enum';
import { Recommendation } from './entities/recommendation.entity';
import {
  RecommendationGenerationJobService,
  type RecommendationGenerationJobSummary,
} from './recommendation-generation-job.service';
import { RecommendationNotificationService } from './recommendation-notification.service';
import { QuestionnaireRelevanceRankerService } from './questionnaire-relevance-ranker.service';
import {
  RecommendationScoringService,
  type GeneratedRecommendationItem,
  type ServiceCandidate,
} from './recommendation-scoring.service';
import {
  ensureDependencyGraphIsValid,
  validateDependencyIds,
} from './dependency-graph.utils';

const RECOMMENDABLE_SERVICE_SCAN_LIMIT = 500;
const MIN_RECOMMENDATION_RANKING_SCORE = 5;

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
  priority: RecommendationPriority;
  rationale: string | null;
  dependencyIds: string[];
  diagnosticSignals: string[];
  createdAt: Date;
  services?: PackageInnerServiceItem[];
};

export type AdminRecommendationListItem = {
  id: string;
  serviceId: string | null;
  packageId: string | null;
  category: string;
  status: RecommendationStatus;
  priority: RecommendationPriority;
  price: number;
  rationale: string | null;
  dependencyIds: string[];
};

@Injectable()
export class RecommendationsService implements OnModuleInit {
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
    @InjectRepository(Questionnaire)
    private readonly questionnaireRepository: Repository<Questionnaire>,
    private readonly scoringService: RecommendationScoringService,
    private readonly relevanceRanker: QuestionnaireRelevanceRankerService,
    private readonly generationJobService: RecommendationGenerationJobService,
    private readonly notificationService: RecommendationNotificationService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.generationJobService.recoverInterruptedGenerationJobs();
    this.generationJobService.schedulePendingGenerationJobs((job) =>
      this.runGenerationJob(job),
    );
    this.generationJobService.startRecoveryLoop((job) =>
      this.runGenerationJob(job),
    );
  }

  // ── User-facing queries ───────────────────────────────────────────

  async findAssignedToUser(userId: string): Promise<Recommendation[]> {
    return this.recommendationRepository
      .createQueryBuilder('recommendation')
      .leftJoinAndSelect('recommendation.service', 'service')
      .leftJoinAndSelect('recommendation.package', 'package')
      .leftJoinAndSelect('package.category', 'packageCategory')
      .leftJoinAndSelect('recommendation.order', 'order')
      .where('recommendation."userId" = :userId', { userId })
      .andWhere(this.visibleRecommendationTargetFilter())
      .orderBy(
        `CASE recommendation.priority WHEN 'urgent' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END`,
        'ASC',
      )
      .addOrderBy('recommendation."createdAt"', 'DESC')
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
      .addSelect("COALESCE(serviceCategory.name, packageCategory.name, '')", 'category')
      .addSelect('COALESCE(service.price, package.price)', 'price')
      .addSelect('recommendation.status', 'status')
      .addSelect('recommendation.priority', 'priority')
      .addSelect('recommendation.rationale', 'rationale')
      .addSelect('recommendation."dependencyIds"', 'dependencyIds')
      .addSelect('recommendation."diagnosticSignals"', 'diagnosticSignals')
      .addSelect('recommendation."createdAt"', 'createdAt')
      .where('recommendation."userId" = :userId', { userId })
      .andWhere(this.visibleRecommendationTargetFilter())
      .orderBy(
        `CASE recommendation.priority WHEN 'urgent' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END`,
        'ASC',
      )
      .addOrderBy('recommendation."createdAt"', 'DESC')
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
        filterActiveServices(pkg.services).map((service) => ({
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
      .andWhere(this.visibleRecommendationTargetFilter())
      .orderBy(
        `CASE recommendation.priority WHEN 'urgent' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END`,
        'ASC',
      )
      .addOrderBy('recommendation."createdAt"', 'DESC')
      .getMany();
  }

  // ── Admin CRUD (merged from develop) ──────────────────────────────

  async createForAdmin(dto: CreateAdminRecommendationDto): Promise<Recommendation> {
    const user = await this.getUserOrThrow(dto.userId);
    const target = await this.resolveAndValidateRecommendationTarget(dto.serviceId, dto.packageId);
    await this.ensureRecommendationIsUnique(dto.userId, target.serviceId, target.packageId);
    await ensureDependencyGraphIsValid(
      this.recommendationRepository,
      dto.dependencyIds ?? [],
      undefined,
      dto.userId,
    );
    const shouldNotify =
      await this.notificationService.shouldNotifyAboutNewRecommendation(user);

    const recommendation = this.recommendationRepository.create({
      userId: dto.userId,
      serviceId: target.serviceId,
      packageId: target.packageId,
      status: dto.status ?? RecommendationStatus.Recommended,
      priority: dto.priority ?? RecommendationPriority.Medium,
      rationale: dto.rationale ?? null,
      dependencyIds: this.uniqueIds(dto.dependencyIds ?? []),
      diagnosticSignals: this.scoringService.normalizeSignals(dto.diagnosticSignals ?? []),
      generatedAt: null,
      orderId: null,
    });

    const saved = await this.recommendationRepository.save(recommendation);

    if (shouldNotify) {
      await this.notificationService.notifyUserAboutRecommendations(user, saved);
    }

    return this.findRecommendationWithRelationsOrThrow(saved.id);
  }

  async markRecommendationsSeen(
    userId: string,
  ): Promise<{ notificationsSeenAt: Date }> {
    const user = await this.getUserOrThrow(userId);
    return this.notificationService.markSeen(user);
  }

  async updateForAdmin(
    id: string,
    dto: UpdateAdminRecommendationDto,
  ): Promise<Recommendation> {
    const recommendation = await this.getRecommendationOrThrow(id);

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

    if (dto.status !== undefined) recommendation.status = dto.status;
    if (dto.priority !== undefined) recommendation.priority = dto.priority;
    if (dto.rationale !== undefined) recommendation.rationale = dto.rationale;

    if (dto.dependencyIds) {
      recommendation.dependencyIds = await validateDependencyIds(
        this.recommendationRepository,
        recommendation.id,
        dto.dependencyIds,
        recommendation.userId,
      );
    }

    if (dto.diagnosticSignals) {
      recommendation.diagnosticSignals =
        this.scoringService.normalizeSignals(dto.diagnosticSignals);
    }

    const saved = await this.recommendationRepository.save(recommendation);
    return this.findRecommendationWithRelationsOrThrow(saved.id);
  }

  // ── User self-service ─────────────────────────────────────────────

  async updateForUser(
    userId: string,
    id: string,
    dto: UpdateUserRecommendationDto,
  ): Promise<Recommendation> {
    const recommendation = await this.getUserRecommendationOrThrow(userId, id);
    recommendation.status = dto.status;
    return this.recommendationRepository.save(recommendation);
  }

  async completeForUser(userId: string, id: string): Promise<Recommendation> {
    return this.updateForUser(userId, id, {
      status: RecommendationStatus.Completed,
    });
  }

  // ── Dependency graph (admin) ──────────────────────────────────────

  async updateDependenciesForAdmin(
    id: string,
    dependencyIds: string[],
  ): Promise<Recommendation> {
    const recommendation = await this.getRecommendationOrThrow(id);
    recommendation.dependencyIds = await validateDependencyIds(
      this.recommendationRepository,
      recommendation.id,
      dependencyIds,
      recommendation.userId,
    );
    return this.recommendationRepository.save(recommendation);
  }

  // ── Async generation jobs ─────────────────────────────────────────

  async startGenerationForUser(
    userId: string,
    dto: Omit<GenerateRecommendationsDto, 'userId'>,
  ): Promise<RecommendationGenerationJobSummary> {
    await this.ensureUserExists(userId);
    const request = {
      ...dto,
      clientProfile: await this.resolveClientProfile(
        userId,
        dto.clientProfile,
      ),
    };

    return this.generationJobService.startGenerationForUser(
      userId,
      request,
      (job) => this.runGenerationJob(job),
    );
  }

  async findGenerationJobForUser(
    userId: string,
    id: string,
  ): Promise<RecommendationGenerationJobSummary> {
    return this.generationJobService.findGenerationJobForUser(userId, id);
  }

  // ── AI-driven generation ──────────────────────────────────────────

  async generateForUser(
    dto: GenerateRecommendationsDto,
  ): Promise<GeneratedRecommendationItem[]> {
    await this.ensureUserExists(dto.userId);
    const effectiveDto: GenerateRecommendationsDto = {
      ...dto,
      clientProfile: await this.resolveClientProfile(
        dto.userId,
        dto.clientProfile,
      ),
    };

    const limit = dto.limit;
    const services = await this.findRecommendableServices();
    const context = this.scoringService.buildDiagnosticContext(effectiveDto);
    let ranked = await this.scoringService.generateAiRecommendations(
      effectiveDto,
      services,
      context,
    );

    if (ranked.length === 0) {
      ranked = services
        .map((service) => this.scoringService.scoreService(service, context))
        .filter((item) => item.score > 0)
        .sort((a, b) => b.score - a.score);
    }

    ranked = this.relevanceRanker.rankRecommendations(
      effectiveDto,
      services,
      ranked,
      context,
      limit,
    );
    ranked = ranked.filter(
      (item) => Number(item.score || 0) >= MIN_RECOMMENDATION_RANKING_SCORE,
    );
    ranked = this.filterOverlappingRecommendations(
      ranked,
      await this.findExistingRecommendationCoverage(dto.userId),
    );

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

  // ── Admin delete ──────────────────────────────────────────────────

  async removeForAdmin(id: string): Promise<void> {
    const result = await this.recommendationRepository.delete({ id });
    if (!result.affected) {
      throw new NotFoundException(`Recommendation with id ${id} not found`);
    }
  }

  // ── Private helpers ───────────────────────────────────────────────

  private async findExistingRecommendationCoverage(
    _userId: string,
  ): Promise<Array<{ targetId: string; coveredServiceIds: Set<string>; blocksOverlaps: boolean }>> {
    // NOTE: overlap filtering helpers are intentionally no-op in this branch
    // to keep generation stable after cherry-pick of ranking threshold logic.
    return [];
  }

  private filterOverlappingRecommendations(
    ranked: GeneratedRecommendationItem[],
    _existing: Array<{ targetId: string; coveredServiceIds: Set<string>; blocksOverlaps: boolean }>,
  ): GeneratedRecommendationItem[] {
    return ranked;
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

  private async getUserRecommendationOrThrow(
    userId: string,
    id: string,
  ): Promise<Recommendation> {
    const recommendation = await this.recommendationRepository.findOne({
      where: { id, userId },
    });
    if (!recommendation) {
      throw new NotFoundException(`Recommendation with id ${id} not found`);
    }
    return recommendation;
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

  private async findRecommendableServices(): Promise<ServiceCandidate[]> {
    return this.serviceRepository
      .createQueryBuilder('service')
      .leftJoinAndSelect('service.category', 'category')
      .where('service.type IN (:...serviceTypes)', {
        serviceTypes: [ServiceType.Service, ServiceType.Document],
      })
      .andWhere('service."deletedAt" IS NULL')
      .orderBy('service.createdAt', 'DESC')
      .take(RECOMMENDABLE_SERVICE_SCAN_LIMIT)
      .getMany() as Promise<ServiceCandidate[]>;
  }

  private async resolveClientProfile(
    userId: string,
    clientProfile?: Record<string, unknown>,
  ): Promise<Record<string, unknown> | undefined> {
    const questionnaire = await this.questionnaireRepository.findOne({
      where: { userId },
    });
    const savedProfile = questionnaire?.answers as
      | Record<string, unknown>
      | undefined;

    if (savedProfile && this.hasClientProfile(clientProfile)) {
      return this.mergeProfiles(savedProfile, clientProfile);
    }

    return savedProfile ?? clientProfile;
  }

  private hasClientProfile(
    clientProfile?: Record<string, unknown>,
  ): clientProfile is Record<string, unknown> {
    return Boolean(
      clientProfile &&
        typeof clientProfile === 'object' &&
        Object.keys(clientProfile).length > 0,
      );
  }

  private mergeProfiles(
    base: Record<string, unknown>,
    override: Record<string, unknown>,
  ): Record<string, unknown> {
    const result: Record<string, unknown> = { ...base };

    Object.entries(override).forEach(([key, overrideValue]) => {
      if (overrideValue === undefined) return;

      const baseValue = result[key];
      if (this.isPlainObject(baseValue) && this.isPlainObject(overrideValue)) {
        result[key] = this.mergeProfiles(baseValue, overrideValue);
        return;
      }

      result[key] = overrideValue;
    });

    return result;
  }

  private isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  private async upsertGeneratedRecommendation(
    userId: string,
    item: GeneratedRecommendationItem,
  ): Promise<Recommendation> {
    const where = { userId, serviceId: item.serviceId };

    const existing = await this.recommendationRepository.findOne({
      where,
    });

    if (existing) {
      existing.priority = item.priority;
      existing.rationale = item.rationale;
      existing.diagnosticSignals = item.diagnosticSignals;
      existing.generatedAt = new Date();
      return this.recommendationRepository.save(existing);
    }

    const recommendation = this.recommendationRepository.create({
      userId,
      serviceId: item.serviceId,
      packageId: null,
      status: RecommendationStatus.Recommended,
      priority: item.priority,
      rationale: item.rationale,
      dependencyIds: [],
      diagnosticSignals: item.diagnosticSignals,
      generatedAt: new Date(),
      orderId: null,
    });

    try {
      return await this.recommendationRepository.save(recommendation);
    } catch (error) {
      if (!this.isUniqueConstraintViolation(error)) {
        throw error;
      }
      const retryExisting = await this.recommendationRepository.findOne({
        where,
      });
      if (!retryExisting) throw error;
      retryExisting.priority = item.priority;
      retryExisting.rationale = item.rationale;
      retryExisting.diagnosticSignals = item.diagnosticSignals;
      retryExisting.generatedAt = new Date();
      return this.recommendationRepository.save(retryExisting);
    }
  }

  // ── Job processing ────────────────────────────────────────────────

  // ── Resolve target (from develop) ─────────────────────────────────

  private async runGenerationJob(
    job: RecommendationGenerationJob,
  ): Promise<Record<string, unknown>[]> {
    const request = job.request as Partial<GenerateRecommendationsDto>;
    const recommendations = await this.generateForUser({
      userId: job.userId,
      clientProfile: request.clientProfile,
      diagnostics: request.diagnostics,
      limit: request.limit,
      persist: request.persist,
    });

    return recommendations.map((item) => ({
      serviceId: item.serviceId,
      serviceName: item.serviceName,
      priority: item.priority,
      rationale: item.rationale,
      diagnosticSignals: item.diagnosticSignals,
      score: item.score,
      recommendationId: item.recommendation?.id,
    }));
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

  // ── Validation helpers ────────────────────────────────────────────

  private async getUserOrThrow(userId: string): Promise<User> {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException(`User with id ${userId} not found`);
    }
    return user;
  }

  private async ensureUserExists(userId: string): Promise<void> {
    await this.getUserOrThrow(userId);
  }

  private async ensureServiceCanBeRecommended(serviceId: string): Promise<void> {
    const service = await this.serviceRepository.findOne({
      where: { id: serviceId, deletedAt: IsNull() },
    });
    if (!service) {
      throw new NotFoundException(`Service with id ${serviceId} not found`);
    }
    if (service.type !== ServiceType.Service && service.type !== ServiceType.Document) {
      throw new BadRequestException(
        'Only services and documents can be assigned as recommendations',
      );
    }
  }

  private async ensurePackageCanBeRecommended(packageId: string): Promise<void> {
    const servicePackage = await this.packageRepository.findOne({
      where: { id: packageId, ...activePackageWhere() },
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

  private uniqueIds(ids: string[]): string[] {
    return Array.from(new Set(ids));
  }

  private isUniqueConstraintViolation(error: unknown): boolean {
    return Boolean(
      error &&
        typeof error === 'object' &&
        (error as { code?: unknown }).code === '23505',
    );
  }

  private visibleRecommendationTargetFilter(): Brackets {
    return new Brackets((qb) => {
      qb
        .where(
          'service.type IN (:...serviceTypes) AND service."deletedAt" IS NULL',
          { serviceTypes: [ServiceType.Service, ServiceType.Document] },
        )
        .orWhere('package.id IS NOT NULL AND package."deletedAt" IS NULL');
    });
  }
}
