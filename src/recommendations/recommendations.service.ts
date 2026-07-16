import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, IsNull, Repository } from 'typeorm';
import { OrderItem } from '../orders/entities/order-item.entity';
import { OrderStatus } from '../orders/entities/order-status.enum';
import { Order } from '../orders/entities/order.entity';
import { ServicePackage } from '../packages/entities/package.entity';
import { Service } from '../services/entities/service.entity';
import { publicPackageWhere } from '../packages/package-visibility';
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
import {
  MIN_RECOMMENDATION_RANKING_SCORE,
  QuestionnaireRelevanceRankerService,
} from './questionnaire-relevance-ranker.service';
import { RecommendationSource } from './entities/recommendation-source.enum';
import {
  RecommendationScoringService,
  type GeneratedRecommendationItem,
  type ServiceCandidate,
} from './recommendation-scoring.service';
import { RECOMMENDATION_CATALOG_ENTRIES } from './recommendation-catalog.registry';
import {
  ensureDependencyGraphIsValid,
  validateDependencyIds,
} from './dependency-graph.utils';
import {
  getCoverageRecommendationTargetId,
  selectNonOverlappingRecommendations,
} from './recommendation-coverage.util';

const RECOMMENDABLE_SERVICE_SCAN_LIMIT = 500;
const REGISTERED_RECOMMENDATION_CATALOG_IDS = new Set(
  RECOMMENDATION_CATALOG_ENTRIES.map((entry) => entry.id),
);

type LogicalCoverageRule = {
  key: string;
  variants?: string[];
  terms?: string[];
  minTerms?: number;
};

const LOGICAL_COVERAGE_RULES: LogicalCoverageRule[] = [
  {
    key: 'vacancy_profile',
    variants: ['профиль вакансии'],
  },
  {
    key: 'candidate_portrait',
    variants: ['портрет соискателя', 'портрет кандидата'],
  },
  {
    key: 'candidate_screening',
    variants: ['скрининг', 'скрининг резюме'],
  },
  {
    key: 'candidate_interview',
    variants: ['интервью', 'собеседование'],
  },
  {
    key: 'turnkey_hiring',
    variants: ['подбор под ключ'],
    terms: ['профиль вакансии', 'портрет', 'скрининг', 'интервью'],
    minTerms: 4,
  },
  {
    key: 'crm_technical_spec',
    variants: [
      'подготовка тз',
      'подготовка технического задания',
      'техническое задание',
    ],
  },
  {
    key: 'crm_audit',
    variants: ['аудит crm'],
    terms: ['аудит', 'crm'],
  },
  {
    key: 'sales_dashboard',
    variants: ['дашборд оп'],
    terms: ['дашборд', 'оп'],
  },
  {
    key: 'sales_department_documents',
    variants: ['пакет документов отдела продаж', 'документы отдела продаж'],
    terms: ['документы', 'отдел продаж'],
  },
  {
    key: 'crm_telephony_integration',
    variants: ['интеграция телефонии'],
    terms: ['интеграция', 'телефони'],
  },
  {
    key: 'crm_messenger_integration',
    variants: ['интеграция мессенджера'],
    terms: ['интеграция', 'мессенджер'],
  },
  {
    key: 'crm_mail_integration',
    variants: ['почтовый сервис', 'интеграция почты'],
    terms: ['интеграция', 'почт'],
  },
];

export type PackageInnerServiceItem = {
  id: string;
  name: string;
  description: string;
  type: ServiceType;
  price: number;
  giftEligible: boolean;
  status: RecommendationStatus | null;
};

function mapOrderStatusToRecommendationStatus(
  status: OrderStatus,
): RecommendationStatus | null {
  switch (status) {
    case OrderStatus.PendingPayment:
    case OrderStatus.Planned:
      return RecommendationStatus.Planned;
    case OrderStatus.InProgress:
      return RecommendationStatus.InProgress;
    case OrderStatus.Completed:
      return RecommendationStatus.Completed;
    case OrderStatus.Cancelled:
      return RecommendationStatus.Recommended;
    default:
      return null;
  }
}

export type UserRecommendationListItem = {
  id: string;
  serviceId: string | null;
  packageId: string | null;
  name: string;
  description: string;
  type: ServiceType | 'Пакет услуг';
  category: string;
  price: number;
  giftEligible: boolean | null;
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
  name: string;
  category: string;
  status: RecommendationStatus;
  source: RecommendationSource;
  priority: RecommendationPriority;
  price: number;
  rationale: string | null;
  dependencyIds: string[];
  diagnosticSignals: string[];
  createdAt: Date;
};

interface ExistingRecommendationCoverage {
  targetId: string;
  coveredServiceIds: Set<string>;
  blocksOverlaps: boolean;
}

@Injectable()
export class RecommendationsService implements OnModuleInit {
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
    @InjectRepository(OrderItem)
    private readonly orderItemRepository: Repository<OrderItem>,
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
      .leftJoinAndSelect('package.categories', 'packageCategory')
      .leftJoinAndSelect('recommendation.order', 'order')
      .where('recommendation."userId" = :userId', { userId })
      .andWhere(this.userRecommendationTargetFilter())
      .orderBy('recommendation."createdAt"', 'DESC')
      .addOrderBy('recommendation.id', 'DESC')
      .getMany();
  }

  async findAssignedToUserList(
    userId: string,
  ): Promise<UserRecommendationListItem[]> {
    const rawRows = await this.recommendationRepository
      .createQueryBuilder('recommendation')
      .leftJoin('recommendation.service', 'service')
      .leftJoin('service.category', 'serviceCategory')
      .leftJoin('recommendation.package', 'package')
      .select('recommendation.id', 'id')
      .addSelect('recommendation."serviceId"', 'serviceId')
      .addSelect('recommendation."packageId"', 'packageId')
      .addSelect('recommendation."orderId"', 'orderId')
      .addSelect('COALESCE(service.name, package.name)', 'name')
      .addSelect(
        `COALESCE(service.description, package.description, '')`,
        'description',
      )
      .addSelect(`COALESCE(service.type, 'Пакет услуг')`, 'type')
      .addSelect(
        `COALESCE(
          serviceCategory.name,
          (SELECT string_agg(c.name, ', ' ORDER BY c."sortOrder" ASC, c.name ASC)
           FROM package_categories pc
           JOIN category c ON c.id = pc."categoryId"
           WHERE pc."packageId" = package.id),
          ''
        )`,
        'category',
      )
      .addSelect('COALESCE(service.price, package.price)', 'price')
      .addSelect(
        'COALESCE(service."giftEligible", package."giftEligible")',
        'giftEligible',
      )
      .addSelect('recommendation.status', 'status')
      .addSelect('recommendation.priority', 'priority')
      .addSelect('recommendation.rationale', 'rationale')
      .addSelect('recommendation."dependencyIds"', 'dependencyIds')
      .addSelect('recommendation."diagnosticSignals"', 'diagnosticSignals')
      .addSelect('recommendation."createdAt"', 'createdAt')
      .where('recommendation."userId" = :userId', { userId })
      .andWhere(this.userRecommendationTargetFilter())
      .orderBy('recommendation."createdAt"', 'DESC')
      .addOrderBy('recommendation.id', 'DESC')
      .getRawMany<
        UserRecommendationListItem & {
          orderId: string | null;
          giftEligible: boolean | 'true' | 'false' | 't' | 'f' | null;
        }
      >();

    const rows: UserRecommendationListItem[] = rawRows.map(
      ({ orderId: _omit, giftEligible, ...rest }) => ({
        ...rest,
        price: Number(rest.price),
        giftEligible: giftEligible == null ? null : giftEligible === true,
      }),
    );

    const packageRows = rawRows.filter((row) => row.packageId);
    if (packageRows.length === 0) return rows;

    const packageIds = packageRows.map((row) => row.packageId as string);
    const packagesWithServices = await this.packageRepository.find({
      where: packageIds.map((id) => ({ id })),
      relations: ['services'],
    });
    const innerServicesByPackageId = new Map<
      string,
      PackageInnerServiceItem[]
    >();
    packagesWithServices.forEach((pkg) => {
      innerServicesByPackageId.set(
        pkg.id,
        filterActiveServices(pkg.services)
          .filter((service) => !service.isHidden)
          .map((service) => ({
            id: service.id,
            name: service.name,
            description: service.description ?? '',
            type: service.type,
            price: Number(service.price),
            giftEligible: service.giftEligible,
            status: null,
          })),
      );
    });

    const subStatusByRecId = await this.loadPackageSubItemStatuses(packageRows);

    const rowsWithPackageServices = rows.map((row) => {
      if (!row.packageId) return row;
      const innerServices = innerServicesByPackageId.get(row.packageId) ?? [];
      const subStatusMap = subStatusByRecId.get(row.id);
      const services = innerServices.map((service) => ({
        ...service,
        status: subStatusMap?.get(service.id) ?? null,
      }));
      return { ...row, services };
    });

    return this.filterPackageCoveredStandaloneRecommendations(
      rowsWithPackageServices,
      packagesWithServices,
    );
  }

  private filterPackageCoveredStandaloneRecommendations(
    rows: UserRecommendationListItem[],
    packages: ServicePackage[],
  ): UserRecommendationListItem[] {
    const packageIds = new Set(
      rows.flatMap((row) =>
        row.packageId && row.status === RecommendationStatus.Recommended
          ? [row.packageId]
          : [],
      ),
    );
    if (packageIds.size === 0) return rows;

    const coveredServiceIds = new Set<string>();
    const coveredServiceNames = new Set<string>();
    packages.forEach((servicePackage) => {
      if (!packageIds.has(servicePackage.id)) return;
      filterActiveServices(servicePackage.services)
        .filter((service) => !service.isHidden)
        .forEach((service) => {
          coveredServiceIds.add(service.id);
          coveredServiceNames.add(this.normalizeCatalogName(service.name));
        });
    });

    return rows.filter((row) => {
      if (!row.serviceId || row.status !== RecommendationStatus.Recommended) {
        return true;
      }

      return (
        !coveredServiceIds.has(row.serviceId) &&
        !coveredServiceNames.has(this.normalizeCatalogName(row.name))
      );
    });
  }

  private async loadPackageSubItemStatuses(
    packageRows: Array<{
      id: string;
      packageId: string | null;
      orderId: string | null;
    }>,
  ): Promise<Map<string, Map<string, RecommendationStatus>>> {
    const orderIds = packageRows.flatMap((row) =>
      row.orderId ? [row.orderId] : [],
    );
    const result = new Map<string, Map<string, RecommendationStatus>>();
    if (orderIds.length === 0) return result;

    const orderItems = await this.orderItemRepository.find({
      where: [...new Set(orderIds)].map((orderId) => ({ orderId })),
      relations: ['subItems'],
    });

    const subItemMapByKey = new Map<
      string,
      Map<string, RecommendationStatus>
    >();
    orderItems.forEach((item) => {
      if (!item.packageId) return;
      const key = `${item.orderId}:${item.packageId}`;
      const inner = new Map<string, RecommendationStatus>();
      item.subItems.forEach((sub) => {
        if (!sub.serviceId) return;
        const mapped = mapOrderStatusToRecommendationStatus(sub.status);
        if (mapped) inner.set(sub.serviceId, mapped);
      });
      subItemMapByKey.set(key, inner);
    });

    packageRows.forEach((row) => {
      if (!row.orderId || !row.packageId) return;
      const map = subItemMapByKey.get(`${row.orderId}:${row.packageId}`);
      if (map) result.set(row.id, map);
    });
    return result;
  }

  async findAssignedToUserForAdmin(
    userId: string,
  ): Promise<AdminRecommendationListItem[]> {
    const rows = await this.recommendationRepository
      .createQueryBuilder('recommendation')
      .leftJoin('recommendation.service', 'service')
      .leftJoin('service.category', 'serviceCategory')
      .leftJoin('recommendation.package', 'package')
      .select('recommendation.id', 'id')
      .addSelect('recommendation."serviceId"', 'serviceId')
      .addSelect('recommendation."packageId"', 'packageId')
      .addSelect('COALESCE(service.name, package.name)', 'name')
      .addSelect(
        `COALESCE(
          serviceCategory.name,
          (SELECT string_agg(c.name, ', ' ORDER BY c."sortOrder" ASC, c.name ASC)
           FROM package_categories pc
           JOIN category c ON c.id = pc."categoryId"
           WHERE pc."packageId" = package.id),
          ''
        )`,
        'category',
      )
      .addSelect('COALESCE(service.price, package.price)', 'price')
      .addSelect('recommendation.status', 'status')
      .addSelect('recommendation.source', 'source')
      .addSelect('recommendation.priority', 'priority')
      .addSelect('recommendation.rationale', 'rationale')
      .addSelect('recommendation."dependencyIds"', 'dependencyIds')
      .addSelect('recommendation."diagnosticSignals"', 'diagnosticSignals')
      .addSelect('recommendation."createdAt"', 'createdAt')
      .where('recommendation."userId" = :userId', { userId })
      .orderBy('recommendation."createdAt"', 'DESC')
      .addOrderBy('recommendation.id', 'DESC')
      .getRawMany<AdminRecommendationListItem>();

    return rows.map((row) => ({
      ...row,
      price: Number(row.price),
      dependencyIds: row.dependencyIds ?? [],
      diagnosticSignals: row.diagnosticSignals ?? [],
    }));
  }

  // ── Admin CRUD (merged from develop) ──────────────────────────────

  async createForAdmin(
    dto: CreateAdminRecommendationDto,
  ): Promise<Recommendation> {
    const user = await this.getUserOrThrow(dto.userId);
    const target = await this.resolveAndValidateRecommendationTarget(
      dto.serviceId,
      dto.packageId,
    );
    await this.ensureRecommendationIsUnique(
      dto.userId,
      target.serviceId,
      target.packageId,
    );
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
      diagnosticSignals: this.scoringService.normalizeSignals(
        dto.diagnosticSignals ?? [],
      ),
      generatedAt: null,
      source: RecommendationSource.Manual,
      orderId: null,
    });

    const saved = await this.recommendationRepository.save(recommendation);
    if (saved.packageId && saved.status === RecommendationStatus.Recommended) {
      await this.pruneReplaceableRecommendationsCoveredByPackage(
        saved.userId,
        saved.packageId,
      );
    }

    if (shouldNotify) {
      await this.notificationService.notifyUserAboutRecommendations(
        user,
        saved,
      );
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

    const shouldUpdateTarget =
      dto.serviceId !== undefined || dto.packageId !== undefined;
    if (shouldUpdateTarget) {
      const target = await this.resolveUpdateRecommendationTarget(dto);
      const changedTarget =
        target.serviceId !== recommendation.serviceId ||
        target.packageId !== recommendation.packageId;

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
      recommendation.diagnosticSignals = this.scoringService.normalizeSignals(
        dto.diagnosticSignals,
      );
    }

    const saved = await this.recommendationRepository.save(recommendation);
    if (saved.packageId && saved.status === RecommendationStatus.Recommended) {
      await this.pruneReplaceableRecommendationsCoveredByPackage(
        saved.userId,
        saved.packageId,
      );
    }
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
      clientProfile: await this.resolveClientProfile(userId, dto.clientProfile),
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

    ranked = this.relevanceRanker.rankRecommendations(
      effectiveDto,
      services,
      ranked,
      context,
      undefined,
    );
    ranked = ranked.filter(
      (item) => Number(item.score || 0) >= MIN_RECOMMENDATION_RANKING_SCORE,
    );
    ranked.sort((a, b) => this.compareGeneratedRecommendations(a, b));
    ranked = this.filterOverlappingRecommendations(
      ranked,
      await this.findExistingRecommendationCoverage(dto.userId),
    );
    ranked.sort((a, b) => this.compareGeneratedRecommendations(a, b));
    if (limit !== undefined) {
      ranked = ranked.slice(0, limit);
    }

    if (dto.persist === false) {
      return ranked.map((item) =>
        this.toPublicGeneratedRecommendationItem(item),
      );
    }

    const persisted: GeneratedRecommendationItem[] = [];

    for (const item of ranked) {
      const recommendation = await this.upsertGeneratedRecommendation(
        dto.userId,
        item,
      );
      persisted.push(
        this.toPublicGeneratedRecommendationItem({ ...item, recommendation }),
      );
    }

    await this.pruneStaleGeneratedRecommendations(dto.userId, ranked);
    const compactedRecommendationIds =
      await this.compactReplaceableRecommendationSnapshot(dto.userId);

    return persisted.filter(
      (item) =>
        !item.recommendation?.id ||
        !compactedRecommendationIds.has(item.recommendation.id),
    );
  }

  // ── Admin delete ──────────────────────────────────────────────────

  async removeForAdmin(id: string): Promise<void> {
    const result = await this.recommendationRepository.delete({ id });
    if (!result.affected) {
      throw new NotFoundException(`Recommendation with id ${id} not found`);
    }
  }

  // ── Private helpers ───────────────────────────────────────────────

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

  private async findRecommendationWithRelationsOrThrow(
    id: string,
  ): Promise<Recommendation> {
    const recommendation = await this.recommendationRepository.findOne({
      where: { id },
      relations: [
        'service',
        'service.category',
        'package',
        'package.categories',
        'order',
      ],
    });
    if (!recommendation) {
      throw new NotFoundException(`Recommendation with id ${id} not found`);
    }
    return recommendation;
  }

  private async findRecommendableServices(): Promise<ServiceCandidate[]> {
    const [services, packages] = await Promise.all([
      this.serviceRepository
        .createQueryBuilder('service')
        .leftJoinAndSelect('service.category', 'category')
        .where('service.type IN (:...serviceTypes)', {
          serviceTypes: [ServiceType.Service, ServiceType.Document],
        })
        .andWhere('service."deletedAt" IS NULL')
        .andWhere('service."isHidden" = false')
        .orderBy('service.createdAt', 'DESC')
        .take(RECOMMENDABLE_SERVICE_SCAN_LIMIT)
        .getMany(),
      this.packageRepository.find({
        where: publicPackageWhere(),
        relations: ['categories', 'services', 'services.category'],
        order: { createdAt: 'DESC' },
      }),
    ]);
    const packageCandidates = this.deduplicatePackagesByName(packages)
      .map((servicePackage) => {
        const activeServices = filterActiveServices(
          servicePackage.services,
        ).filter((service) => !service.isHidden);
        if (activeServices.length === 0) return null;
        if (this.isPlaceholderPackageCandidate(servicePackage)) return null;
        const coverageIds = this.getPackageCoverageIds(activeServices);

        return {
          id: servicePackage.id,
          serviceId: null,
          packageId: servicePackage.id,
          name: servicePackage.name,
          description: [
            servicePackage.description,
            servicePackage.packageType,
            ...(servicePackage.categories ?? []).map((c) => c.name),
            ...activeServices.flatMap((service) => [
              service.name,
              service.description,
              service.category?.name,
            ]),
          ].join(' '),
          type: 'Пакет услуг',
          price: servicePackage.price,
          image: null,
          skills: [
            ...(servicePackage.tags ?? []),
            ...activeServices.flatMap((service) => [
              service.name,
              service.description,
              ...(service.skills ?? []),
            ]),
          ],
          categoryId: servicePackage.categoryId,
          category: servicePackage.category,
          contractorRatePerHour: null,
          contractorExperienceYears: null,
          userId: null,
          user: null,
          packages: [],
          createdAt: servicePackage.createdAt,
          deletedAt: servicePackage.deletedAt,
          coveredServiceIds: coverageIds,
        } as unknown as ServiceCandidate;
      })
      .filter((candidate): candidate is ServiceCandidate => Boolean(candidate));
    const serviceCandidates = this.deduplicateServicesByName(
      services.filter(
        (service) =>
          this.hasRecommendableServiceContent(service) &&
          !this.isDuplicateLegacyPackageService(service, packageCandidates),
      ),
    ).map((service) => ({
      ...service,
      serviceId: service.id,
      packageId: null,
      coveredServiceIds: this.uniqueIds([
        service.id,
        ...this.getServiceCoverageKeys(service),
      ]),
    })) as ServiceCandidate[];

    return [...packageCandidates, ...serviceCandidates];
  }

  private deduplicatePackagesByName(
    packages: ServicePackage[],
  ): ServicePackage[] {
    const byName = new Map<string, ServicePackage>();

    packages.forEach((servicePackage) => {
      const key = this.normalizeCatalogName(servicePackage.name);
      const existing = byName.get(key);
      if (
        !existing ||
        this.shouldPreferDuplicatePackage(servicePackage, existing)
      ) {
        byName.set(key, servicePackage);
      }
    });

    return Array.from(byName.values());
  }

  private shouldPreferDuplicatePackage(
    candidate: ServicePackage,
    existing: ServicePackage,
  ): boolean {
    const candidateIsRegistered = REGISTERED_RECOMMENDATION_CATALOG_IDS.has(
      candidate.id,
    );
    const existingIsRegistered = REGISTERED_RECOMMENDATION_CATALOG_IDS.has(
      existing.id,
    );
    if (candidateIsRegistered !== existingIsRegistered) {
      return candidateIsRegistered;
    }

    const candidateServices = filterActiveServices(candidate.services).filter(
      (service) => !service.isHidden,
    ).length;
    const existingServices = filterActiveServices(existing.services).filter(
      (service) => !service.isHidden,
    ).length;
    if (candidateServices !== existingServices) {
      return candidateServices > existingServices;
    }

    const candidateCreatedAt = candidate.createdAt?.getTime?.() ?? 0;
    const existingCreatedAt = existing.createdAt?.getTime?.() ?? 0;
    if (candidateCreatedAt !== existingCreatedAt) {
      return candidateCreatedAt > existingCreatedAt;
    }

    return candidate.id.localeCompare(existing.id) < 0;
  }

  private deduplicateServicesByName(services: Service[]): Service[] {
    const byName = new Map<string, Service>();

    services.forEach((service) => {
      const key = this.normalizeCatalogName(service.name);
      const existing = byName.get(key);
      if (!existing || this.shouldPreferDuplicateService(service, existing)) {
        byName.set(key, service);
      }
    });

    return Array.from(byName.values());
  }

  private shouldPreferDuplicateService(
    candidate: Service,
    existing: Service,
  ): boolean {
    const candidateIsRegistered = REGISTERED_RECOMMENDATION_CATALOG_IDS.has(
      candidate.id,
    );
    const existingIsRegistered = REGISTERED_RECOMMENDATION_CATALOG_IDS.has(
      existing.id,
    );
    if (candidateIsRegistered !== existingIsRegistered) {
      return candidateIsRegistered;
    }

    if (candidate.type !== existing.type) {
      return (
        candidate.type === ServiceType.Service &&
        existing.type === ServiceType.Document
      );
    }

    const candidateCreatedAt = candidate.createdAt?.getTime?.() ?? 0;
    const existingCreatedAt = existing.createdAt?.getTime?.() ?? 0;
    if (candidateCreatedAt !== existingCreatedAt) {
      return candidateCreatedAt > existingCreatedAt;
    }

    return candidate.id.localeCompare(existing.id) < 0;
  }

  private isDuplicateLegacyPackageService(
    service: Service,
    packageCandidates: ServiceCandidate[],
  ): boolean {
    if (service.category?.name !== 'Пакет услуг') return false;

    const serviceName = this.normalizeCatalogName(service.name);
    return packageCandidates.some((candidate) => {
      const candidateName = this.normalizeCatalogName(candidate.name);
      const serviceCoverageKeys = this.getServiceCoverageKeys(service);
      return (
        candidateName === serviceName ||
        Boolean(candidate.coveredServiceIds?.includes(service.id)) ||
        serviceCoverageKeys.some((coverageKey) =>
          candidate.coveredServiceIds?.includes(coverageKey),
        )
      );
    });
  }

  private getPackageCoverageIds(activeServices: Service[]): string[] {
    return this.uniqueIds(
      activeServices
        .filter((service) => !service.deletedAt)
        .map((service) =>
          this.getServiceCoverageKeys(service).find((coverageKey) =>
            coverageKey.startsWith('catalog_name:'),
          ) ?? service.id,
        ),
    );
  }

  private getServiceCoverageKeys(service: Service): string[] {
    return this.getLogicalCoverageKeys(
      [
        service.name,
        service.description,
        service.category?.name,
        ...(service.skills ?? []),
      ],
      [service.name],
    );
  }

  private getLogicalCoverageKeys(
    parts: Array<string | null | undefined>,
    exactNameParts: Array<string | null | undefined> = [],
  ): string[] {
    const normalizedParts = parts
      .filter((part): part is string => Boolean(part))
      .map((part) => this.normalizeCatalogName(part));
    const normalizedExactNameParts = exactNameParts
      .filter((part): part is string => Boolean(part))
      .map((part) => this.normalizeCatalogName(part));
    const normalizedText = normalizedParts.join(' ');
    const keys = new Set<string>();

    normalizedExactNameParts.forEach((part) => {
      if (part && part.length >= 4) {
        keys.add(`catalog_name:${part}`);
      }
    });

    LOGICAL_COVERAGE_RULES.forEach((rule) => {
      if (this.matchesLogicalCoverageRule(normalizedText, rule)) {
        keys.add(`catalog_semantic:${rule.key}`);
      }
    });

    return Array.from(keys);
  }

  private matchesLogicalCoverageRule(
    normalizedText: string,
    rule: LogicalCoverageRule,
  ): boolean {
    const variants = rule.variants ?? [];
    if (
      variants.some((variant) =>
        normalizedText.includes(this.normalizeCatalogName(variant)),
      )
    ) {
      return true;
    }

    const terms = rule.terms ?? [];
    if (terms.length === 0) return false;

    const matchedTerms = terms.filter((term) =>
      normalizedText.includes(this.normalizeCatalogName(term)),
    ).length;

    return matchedTerms >= (rule.minTerms ?? terms.length);
  }

  private hasRecommendableServiceContent(service: Service): boolean {
    if (this.isPlaceholderCatalogName(service.name)) return false;
    if (service.category?.name !== 'Пакет услуг') return true;

    const text = this.normalizeCatalogName(
      [
        service.name,
        service.description,
        service.category?.name,
        ...(service.skills ?? []),
      ].join(' '),
    );
    const body = this.normalizeCatalogName(
      [service.description, ...(service.skills ?? [])].join(' '),
    );

    if (!body) return false;
    return !this.isPlaceholderCatalogText(text);
  }

  private isPlaceholderPackageCandidate(
    servicePackage: ServicePackage,
  ): boolean {
    if (this.isPlaceholderCatalogName(servicePackage.name)) return true;

    const text = this.normalizeCatalogName(
      [
        servicePackage.name,
        servicePackage.description,
        servicePackage.packageType,
        ...(servicePackage.tags ?? []),
      ].join(' '),
    );
    const body = this.normalizeCatalogName(
      [servicePackage.description, ...(servicePackage.tags ?? [])].join(' '),
    );

    return !body && this.isPlaceholderCatalogText(text);
  }

  private isPlaceholderCatalogName(name: string): boolean {
    return this.isPlaceholderCatalogText(this.normalizeCatalogName(name));
  }

  private isPlaceholderCatalogText(text: string): boolean {
    const tokens = new Set(text.split(' ').filter(Boolean));
    return ['test', 'тест', 'тестовый', 'demo', 'демо'].some((token) =>
      tokens.has(token),
    );
  }

  private normalizeCatalogName(name: string): string {
    return name
      .normalize('NFKC')
      .toLowerCase()
      .replace(/ё/g, 'е')
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
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

  private async findExistingRecommendationCoverage(
    userId: string,
  ): Promise<ExistingRecommendationCoverage[]> {
    const recommendations = await this.recommendationRepository.find({
      where: { userId },
      relations: [
        'service',
        'service.category',
        'package',
        'package.categories',
        'package.services',
        'package.services.category',
      ],
    });
    const coverage: ExistingRecommendationCoverage[] = [];

    recommendations.forEach((recommendation) => {
      if (!this.isRecommendationTargetAvailable(recommendation)) return;
      const targetId = this.getRecommendationTargetId(recommendation);
      if (!targetId) return;
      coverage.push({
        targetId,
        coveredServiceIds: new Set(
          this.getRecommendationCoveredServiceIds(recommendation),
        ),
        blocksOverlaps: !this.isReplaceableRecommendation(recommendation),
      });
    });

    return coverage;
  }

  private isRecommendationTargetAvailable(
    recommendation: Recommendation,
  ): boolean {
    if (recommendation.serviceId) {
      return Boolean(
        !recommendation.service ||
        (recommendation.service &&
          recommendation.service.deletedAt == null &&
          !recommendation.service.isHidden),
      );
    }

    return Boolean(
      !recommendation.package ||
      (recommendation.package &&
        recommendation.package.deletedAt == null &&
        !recommendation.package.isHidden),
    );
  }

  private filterOverlappingRecommendations(
    items: GeneratedRecommendationItem[],
    existingCoverage: ExistingRecommendationCoverage[],
  ): GeneratedRecommendationItem[] {
    return selectNonOverlappingRecommendations(items, {
      existingCoverage,
      idealTargetIds: new Set(
        items
          .filter((item) => this.isIdealReferenceRecommendation(item))
          .map((item) => this.getGeneratedRecommendationTargetId(item))
          .filter((targetId): targetId is string => Boolean(targetId)),
      ),
    });
  }

  private compareGeneratedRecommendations(
    a: GeneratedRecommendationItem,
    b: GeneratedRecommendationItem,
  ): number {
    const aIsIdeal = this.isIdealReferenceRecommendation(a);
    const bIsIdeal = this.isIdealReferenceRecommendation(b);
    if (aIsIdeal !== bIsIdeal) return aIsIdeal ? -1 : 1;

    return (
      Number(b.score || 0) - Number(a.score || 0) ||
      a.serviceName.localeCompare(b.serviceName, 'ru')
    );
  }

  private isIdealReferenceRecommendation(
    item: GeneratedRecommendationItem,
  ): boolean {
    return this.hasIdealReferenceSignal(item.diagnosticSignals);
  }

  private hasIdealReferenceSignal(
    diagnosticSignals: readonly string[] | null | undefined,
  ): boolean {
    return Boolean(
      diagnosticSignals?.some((signal) =>
        signal.startsWith('ideal_reference:'),
      ),
    );
  }

  private async pruneStaleGeneratedRecommendations(
    userId: string,
    currentItems: GeneratedRecommendationItem[],
  ): Promise<void> {
    const currentTargetIds = new Set(
      currentItems
        .map((item) => this.getGeneratedRecommendationTargetId(item))
        .filter((targetId): targetId is string => Boolean(targetId)),
    );
    const generatedRecommendations = await this.recommendationRepository.find({
      where: {
        userId,
        status: RecommendationStatus.Recommended,
        source: RecommendationSource.AI,
      },
    });
    const staleGeneratedIds = generatedRecommendations
      .filter((recommendation) => {
        if (!this.isReplaceableRecommendation(recommendation)) return false;
        const targetId = this.getRecommendationTargetId(recommendation);
        return !targetId || !currentTargetIds.has(targetId);
      })
      .map((recommendation) => recommendation.id);

    const idsToDelete = staleGeneratedIds;

    if (idsToDelete.length === 0) return;

    await this.recommendationRepository.delete(idsToDelete);
  }

  /**
   * Reconciles the persisted recommendation snapshot after a successful
   * generation. The ranking stage intentionally has score-based protections,
   * but persisted package recommendations must still be compacted by actual
   * coverage: a complete package wins over a replaceable child package.
   *
   * Manual recommendations, recommendations with an order, and lifecycle
   * records that are no longer in the replaceable `recommended` state are
   * treated as locked and are never deleted here.
   */
  private async compactReplaceableRecommendationSnapshot(
    userId: string,
  ): Promise<Set<string>> {
    const recommendations = await this.recommendationRepository.find({
      where: { userId },
      relations: [
        'service',
        'service.category',
        'package',
        'package.services',
        'package.services.category',
      ],
    });

    const replaceableRecommendations = recommendations.filter((recommendation) =>
      this.isReplaceableRecommendation(recommendation),
    );
    if (replaceableRecommendations.length === 0) return new Set();

    const coverageByRecommendationId = new Map<string, Set<string>>();
    recommendations.forEach((recommendation) => {
      coverageByRecommendationId.set(
        recommendation.id,
        new Set(this.getRecommendationOverlapCoverageIds(recommendation)),
      );
    });

    const packageRecommendations = replaceableRecommendations.filter(
      (recommendation) =>
        recommendation.packageId &&
        recommendation.package &&
        recommendation.package.deletedAt == null &&
        !recommendation.package.isHidden &&
        (coverageByRecommendationId.get(recommendation.id)?.size ?? 0) > 0,
    );
    if (packageRecommendations.length < 2) return new Set();
    const coversAll = (coveringId: string, coveredId: string): boolean => {
      const covering = coverageByRecommendationId.get(coveringId) ?? new Set();
      const covered = coverageByRecommendationId.get(coveredId) ?? new Set();
      return (
        covered.size > 0 && [...covered].every((coverageId) => covering.has(coverageId))
      );
    };
    const isPreferredCover = (coveringId: string, coveredId: string): boolean => {
      const covering = coverageByRecommendationId.get(coveringId)?.size ?? 0;
      const covered = coverageByRecommendationId.get(coveredId)?.size ?? 0;
      if (covering !== covered) return covering > covered;
      return coveringId.localeCompare(coveredId) < 0;
    };

    const idsToDelete = replaceableRecommendations
      .filter((recommendation) => {
        if (!coverageByRecommendationId.get(recommendation.id)?.size) {
          return false;
        }

        if (recommendation.packageId) {
          return packageRecommendations.some(
            (covering) =>
              covering.id !== recommendation.id &&
              coversAll(covering.id, recommendation.id) &&
              isPreferredCover(covering.id, recommendation.id),
          );
        }

        // Standalone services are deliberately left untouched here. If a
        // service is relevant, it must remain a recommendation in its own
        // right; package-package compaction must not silently delete it.
        return false;
      })
      .map((recommendation) => recommendation.id);

    if (idsToDelete.length > 0) {
      await this.recommendationRepository.delete(idsToDelete);
    }

    return new Set(idsToDelete);
  }

  private isReplaceableRecommendation(
    recommendation: Pick<
      Recommendation,
      'status' | 'orderId' | 'source' | 'diagnosticSignals'
    >,
  ): boolean {
    return (
      recommendation.source !== RecommendationSource.Manual &&
      recommendation.status === RecommendationStatus.Recommended &&
      recommendation.orderId == null &&
      !this.hasIdealReferenceSignal(recommendation.diagnosticSignals)
    );
  }

  private getGeneratedRecommendationTargetId(
    item: GeneratedRecommendationItem,
  ): string | null {
    return getCoverageRecommendationTargetId(item);
  }

  private toPublicGeneratedRecommendationItem(
    item: GeneratedRecommendationItem,
  ): GeneratedRecommendationItem {
    return {
      ...item,
      coveredServiceIds: this.toPublicCoveredServiceIds(
        item.coveredServiceIds ?? [],
      ),
    };
  }

  private toPublicCoveredServiceIds(coveredServiceIds: string[]): string[] {
    return coveredServiceIds.filter((id) => !this.isInternalCoverageKey(id));
  }

  private isInternalCoverageKey(id: string): boolean {
    return id.startsWith('catalog_name:') || id.startsWith('catalog_semantic:');
  }

  private getRecommendationTargetId(
    recommendation: Recommendation,
  ): string | null {
    return recommendation.packageId ?? recommendation.serviceId ?? null;
  }

  private getRecommendationCoveredServiceIds(
    recommendation: Recommendation,
  ): string[] {
    if (recommendation.packageId && recommendation.package) {
      return this.uniqueIds(
        this.getPackageCoverageIds(
          filterActiveServices(recommendation.package?.services).filter(
            (service) => !service.isHidden,
          ),
        ),
      );
    }

    if (!recommendation.serviceId) return [];

    return this.uniqueIds([
      recommendation.serviceId,
      ...(recommendation.service
        ? this.getServiceCoverageKeys(recommendation.service)
        : []),
    ]);
  }

  private getRecommendationOverlapCoverageIds(
    recommendation: Recommendation,
  ): string[] {
    return this.getSafeOverlapCoverageIds(
      this.getRecommendationCoveredServiceIds(recommendation),
    );
  }

  private getSafeOverlapCoverageIds(coverageIds: string[]): string[] {
    const safeCoverageIds = coverageIds.filter(
      (coverageId) => !coverageId.startsWith('catalog_semantic:'),
    );
    return this.uniqueIds(safeCoverageIds);
  }

  private async upsertGeneratedRecommendation(
    userId: string,
    item: GeneratedRecommendationItem,
  ): Promise<Recommendation> {
    const serviceId = item.serviceId ?? null;
    const packageId = item.packageId ?? null;
    if (!serviceId && !packageId) {
      throw new BadRequestException(
        'Generated recommendation target is missing',
      );
    }
    const where = serviceId
      ? { userId, serviceId }
      : { userId, packageId: packageId as string };

    const existing = await this.recommendationRepository.findOne({
      where,
    });

    if (existing) {
      if (existing.source === RecommendationSource.Manual) {
        return existing;
      }
      existing.priority = item.priority;
      existing.rationale = item.rationale;
      existing.diagnosticSignals = item.diagnosticSignals;
      existing.source = RecommendationSource.AI;
      existing.generatedAt = new Date();
      return this.recommendationRepository.save(existing);
    }

    const recommendation = this.recommendationRepository.create({
      userId,
      serviceId,
      packageId,
      status: RecommendationStatus.Recommended,
      priority: item.priority,
      rationale: item.rationale,
      dependencyIds: [],
      diagnosticSignals: item.diagnosticSignals,
      generatedAt: new Date(),
      source: RecommendationSource.AI,
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
      retryExisting.source = RecommendationSource.AI;
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
    const user = await this.userRepository.findOne({
      where: { id: job.userId },
    });
    const shouldNotify = user
      ? await this.notificationService.shouldNotifyAboutNewRecommendation(user)
      : false;

    const recommendations = await this.generateForUser({
      userId: job.userId,
      clientProfile: request.clientProfile,
      diagnostics: request.diagnostics,
      limit: request.limit,
      persist: request.persist,
    });

    if (shouldNotify && user && recommendations.length > 0) {
      const latest = await this.recommendationRepository.findOne({
        where: { userId: job.userId },
        order: { createdAt: 'DESC' },
      });
      if (latest) {
        try {
          await this.notificationService.notifyUserAboutRecommendations(
            user,
            latest,
          );
        } catch (error) {
          this.logger.warn(
            `Failed to notify user ${job.userId} about generated recommendations: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      }
    }

    return recommendations.map((item) => ({
      serviceId: item.serviceId,
      packageId: item.packageId ?? null,
      serviceName: item.serviceName,
      priority: item.priority,
      rationale: item.rationale,
      diagnosticSignals: item.diagnosticSignals,
      score: item.score,
      coveredServiceIds: this.toPublicCoveredServiceIds(
        item.coveredServiceIds ?? [],
      ),
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
      throw new BadRequestException(
        'Exactly one of serviceId or packageId must be provided',
      );
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
      return this.resolveAndValidateRecommendationTarget(
        dto.serviceId,
        dto.packageId,
      );
    }
    if (hasService) {
      return this.resolveAndValidateRecommendationTarget(
        dto.serviceId,
        undefined,
      );
    }
    return this.resolveAndValidateRecommendationTarget(
      undefined,
      dto.packageId,
    );
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

  private async ensureServiceCanBeRecommended(
    serviceId: string,
  ): Promise<void> {
    const service = await this.serviceRepository.findOne({
      where: { id: serviceId, deletedAt: IsNull(), isHidden: false },
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

  private async ensurePackageCanBeRecommended(
    packageId: string,
  ): Promise<void> {
    const servicePackage = await this.packageRepository.findOne({
      where: { id: packageId, ...publicPackageWhere() },
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
    if (
      serviceId &&
      (await this.isServiceCoveredByRecommendedPackage(
        userId,
        serviceId,
        excludeRecommendationId,
      ))
    ) {
      throw new ConflictException(
        'This service is already included in a recommended package',
      );
    }
  }

  private async isServiceCoveredByRecommendedPackage(
    userId: string,
    serviceId: string,
    excludeRecommendationId?: string,
  ): Promise<boolean> {
    const [service, recommendations] = await Promise.all([
      this.serviceRepository.findOne({
        where: { id: serviceId, deletedAt: IsNull(), isHidden: false },
        relations: ['category'],
      }),
      this.recommendationRepository.find({
        where: { userId, status: RecommendationStatus.Recommended },
        relations: ['package', 'package.services', 'package.services.category'],
      }),
    ]);
    if (!service) return false;

    const serviceCoverage = new Set(
      this.getSafeOverlapCoverageIds([
        service.id,
        ...this.getServiceCoverageKeys(service),
      ]),
    );
    return recommendations.some((recommendation) => {
      if (
        recommendation.id === excludeRecommendationId ||
        !recommendation.packageId ||
        !this.isRecommendationTargetAvailable(recommendation)
      ) {
        return false;
      }

      return this.getRecommendationCoveredServiceIds(recommendation).some(
        (coverageId) => serviceCoverage.has(coverageId),
      );
    });
  }

  private async pruneReplaceableRecommendationsCoveredByPackage(
    userId: string,
    packageId: string,
  ): Promise<void> {
    const [servicePackage, recommendations] = await Promise.all([
      this.packageRepository.findOne({
        where: { id: packageId, ...publicPackageWhere() },
        relations: ['services', 'services.category'],
      }),
      this.recommendationRepository.find({
        where: { userId },
        relations: ['service', 'service.category'],
      }),
    ]);
    if (!servicePackage) return;

    const packageCoverage = new Set(
      this.getSafeOverlapCoverageIds(
        this.getPackageCoverageIds(
          filterActiveServices(servicePackage.services).filter(
            (service) => !service.isHidden,
          ),
        ),
      ),
    );
    const idsToDelete = recommendations
      .filter(
        (recommendation) =>
          recommendation.serviceId &&
          recommendation.service &&
          this.isReplaceableRecommendation(recommendation) &&
          this.getRecommendationCoveredServiceIds(recommendation).some(
            (coverageId) => packageCoverage.has(coverageId),
          ),
      )
      .map((recommendation) => recommendation.id);

    if (idsToDelete.length > 0) {
      await this.recommendationRepository.delete(idsToDelete);
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

  private publicRecommendationTargetFilter(): Brackets {
    return new Brackets((qb) => {
      qb.where(
        'service.type IN (:...serviceTypes) AND service."deletedAt" IS NULL AND service."isHidden" = false',
        { serviceTypes: [ServiceType.Service, ServiceType.Document] },
      ).orWhere(
        'package.id IS NOT NULL AND package."deletedAt" IS NULL AND package."isHidden" = false',
      );
    });
  }

  private userRecommendationTargetFilter(): Brackets {
    return new Brackets((qb) => {
      qb.where(this.publicRecommendationTargetFilter())
        .orWhere('recommendation.status <> :recommendedStatus', {
          recommendedStatus: RecommendationStatus.Recommended,
        })
        .orWhere('recommendation."orderId" IS NOT NULL');
    });
  }
}
