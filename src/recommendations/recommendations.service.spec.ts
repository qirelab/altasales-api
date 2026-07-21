import type { EntityManager } from 'typeorm';
import { ServiceType } from '../services/entities/service-type.enum';
import { OrderStatus } from '../orders/entities/order-status.enum';
import { RecommendationGenerationStatus } from './entities/recommendation-generation-status.enum';
import { RecommendationPriority } from './entities/recommendation-priority.enum';
import { RecommendationSource } from './entities/recommendation-source.enum';
import { RecommendationStatus } from './entities/recommendation-status.enum';
import { RECOMMENDATION_CATALOG } from './recommendation-catalog.registry';
import type { GeneratedRecommendationItem } from './recommendation-scoring.service';
import { RecommendationsService } from './recommendations.service';

describe('RecommendationsService', () => {
  type RecommendationsServiceDependencies = ConstructorParameters<
    typeof RecommendationsService
  >;
  type RecommendationDeletionTestResult = {
    deletedIds: string[];
    blockedBy: Map<string, string[]>;
  };

  const callPrivate = <T>(
    service: RecommendationsService,
    method: string,
    ...args: unknown[]
  ): T => {
    const privateMethod = (
      service as unknown as Record<string, (...args: unknown[]) => T>
    )[method];
    return privateMethod.apply(service, args);
  };
  const userId = 'user-id';
  const twoManagerTurnkeyHiringName = [
    '\u041f\u043e\u0434\u0431\u043e\u0440',
    ' 2\u0445 \u043c\u0435\u043d\u0435\u0434\u0436\u0435\u0440\u043e\u0432',
    ' \u0443\u0434\u0430\u043b\u0435\u043d\u043d\u043e',
    ' \u043f\u043e\u0434 \u043a\u043b\u044e\u0447',
  ].join('');
  const questionnaireAnswers = {
    companyName: 'AltaSales',
    productStage: 'existing',
    targetRevenue: 10000000,
    components: { crm: true, telephony: true },
  };

  const createQueryBuilder = () => {
    const qb = {
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([]),
    };
    return qb;
  };

  const createService = () => {
    const recommendationRepository = {
      createQueryBuilder: jest.fn(),
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn(),
      create: jest.fn((value) => value),
      save: jest.fn((value) => Promise.resolve(value)),
      delete: jest.fn().mockResolvedValue({ affected: 0 }),
    };
    const userRepository = {
      findOne: jest.fn().mockResolvedValue({ id: userId }),
    };
    const serviceRepository = {
      createQueryBuilder: jest.fn(createQueryBuilder),
      findOne: jest.fn(),
    };
    const packageRepository = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn(),
    };
    const orderRepository = {
      findOne: jest.fn(),
    };
    const orderItemRepository = {
      find: jest.fn().mockResolvedValue([]),
    };
    const questionnaireRepository = {
      findOne: jest.fn().mockResolvedValue({
        userId,
        answers: questionnaireAnswers,
      }),
    };
    const scoringService = {
      buildDiagnosticContext: jest.fn().mockReturnValue('context'),
      generateAiRecommendations: jest.fn().mockResolvedValue([]),
      scoreService: jest.fn((candidate) => ({
        serviceId: candidate.packageId ? null : candidate.serviceId,
        packageId: candidate.packageId ?? null,
        serviceName: candidate.name,
        priority: 'medium',
        rationale: 'fallback',
        diagnosticSignals: [],
        score: 0,
        coveredServiceIds: candidate.coveredServiceIds ?? [],
      })),
      normalizeSignals: jest.fn((signals: string[]) => signals),
    };
    const relevanceRanker = {
      rankRecommendations: jest.fn().mockReturnValue([]),
    };
    const generationJobService = {
      startGenerationForUser: jest.fn().mockResolvedValue({
        id: 'job-id',
        status: RecommendationGenerationStatus.Pending,
        userId,
        result: null,
        error: null,
        startedAt: null,
        completedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
      findGenerationJobForUser: jest.fn(),
      recoverInterruptedGenerationJobs: jest.fn(),
      schedulePendingGenerationJobs: jest.fn(),
      startRecoveryLoop: jest.fn(),
    };
    const notificationService = {
      shouldNotifyAboutNewRecommendation: jest.fn(),
      notifyUserAboutRecommendations: jest.fn(),
      markSeen: jest.fn(),
    };

    const dataSource = {
      transaction: jest.fn(
        async (callback: (manager: EntityManager) => unknown) =>
          callback({
            getRepository: jest.fn((entity: { name?: string }) =>
              entity.name === 'ServicePackage'
                ? packageRepository
                : entity.name === 'User'
                  ? userRepository
                  : recommendationRepository,
            ),
          } as unknown as EntityManager),
      ),
    };

    const recommendationUserLockService = {
      lockUser: jest.fn().mockResolvedValue(undefined),
      withUserLock: jest.fn(),
    };

    const service = new RecommendationsService(
      recommendationRepository as unknown as RecommendationsServiceDependencies[0],
      userRepository as unknown as RecommendationsServiceDependencies[1],
      serviceRepository as unknown as RecommendationsServiceDependencies[2],
      packageRepository as unknown as RecommendationsServiceDependencies[3],
      orderRepository as unknown as RecommendationsServiceDependencies[4],
      orderItemRepository as unknown as RecommendationsServiceDependencies[5],
      questionnaireRepository as unknown as RecommendationsServiceDependencies[6],
      scoringService as unknown as RecommendationsServiceDependencies[7],
      relevanceRanker as unknown as RecommendationsServiceDependencies[8],
      generationJobService as unknown as RecommendationsServiceDependencies[9],
      notificationService as unknown as RecommendationsServiceDependencies[10],
      dataSource as unknown as RecommendationsServiceDependencies[11],
      recommendationUserLockService as unknown as RecommendationsServiceDependencies[12],
    );

    return {
      service,
      questionnaireRepository,
      recommendationRepository,
      userRepository,
      serviceRepository,
      packageRepository,
      orderItemRepository,
      scoringService,
      relevanceRanker,
      generationJobService,
      dataSource,
      recommendationUserLockService,
    };
  };

  it('compacts a persisted package and child service with different UUIDs', async () => {
    const { service, recommendationRepository, packageRepository } =
      createService();
    const qb = {
      leftJoin: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue([
        {
          id: 'package-recommendation-id',
          serviceId: null,
          packageId: 'documents-package-id',
          orderId: null,
          name: 'Пакет документов отдела продаж',
          description: 'Документы для отдела продаж',
          type: 'Пакет услуг',
          category: 'Отдел продаж',
          price: '25000',
          giftEligible: false,
          status: RecommendationStatus.Recommended,
          priority: RecommendationPriority.Medium,
          rationale: 'package fit',
          dependencyIds: [],
          diagnosticSignals: [],
          createdAt: new Date('2026-07-15T10:00:00Z'),
        },
        {
          id: 'dashboard-recommendation-id',
          serviceId: 'standalone-dashboard-id',
          packageId: null,
          orderId: null,
          name: 'Дашборд ОП',
          description: 'Отдельный дашборд',
          type: ServiceType.Service,
          category: 'Аналитика',
          price: '10000',
          giftEligible: false,
          status: RecommendationStatus.Recommended,
          priority: RecommendationPriority.Medium,
          rationale: 'analytics',
          dependencyIds: [],
          diagnosticSignals: [],
          createdAt: new Date('2026-07-15T09:00:00Z'),
        },
      ]),
    };
    recommendationRepository.createQueryBuilder.mockReturnValue(qb);
    packageRepository.find.mockResolvedValue([
      {
        id: 'documents-package-id',
        name: 'Пакет документов отдела продаж',
        services: [
          {
            id: 'package-dashboard-id',
            name: 'Дашборд ОП',
            description: 'Дашборд внутри пакета',
            type: ServiceType.Service,
            price: 10000,
            giftEligible: false,
            isHidden: false,
            deletedAt: null,
          },
          {
            id: 'zz-duplicate-package-dashboard-id',
            name: 'Дашборд ОП',
            description: 'Дублирующая строка услуги',
            type: ServiceType.Service,
            price: 10000,
            giftEligible: false,
            isHidden: false,
            deletedAt: null,
          },
        ],
      },
    ]);

    const result = await service.findAssignedToUserList(userId);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(
      expect.objectContaining({
        id: 'package-recommendation-id',
        packageId: 'documents-package-id',
        services: [
          expect.objectContaining({
            id: 'package-dashboard-id',
            name: 'Дашборд ОП',
          }),
        ],
      }),
    );
  });

  it('keeps hidden purchased package services in recommendation history', async () => {
    const {
      service,
      recommendationRepository,
      packageRepository,
      orderItemRepository,
    } = createService();
    const qb = {
      leftJoin: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue([
        {
          id: 'ordered-package-recommendation-id',
          serviceId: null,
          packageId: 'ordered-package-id',
          orderId: 'order-id',
          name: 'Заказанный пакет',
          description: 'Пакет',
          type: 'Пакет услуг',
          category: 'CRM',
          price: '10000',
          giftEligible: false,
          status: RecommendationStatus.Completed,
          priority: RecommendationPriority.Medium,
          rationale: null,
          dependencyIds: [],
          diagnosticSignals: [],
          createdAt: new Date(),
        },
      ]),
    };
    recommendationRepository.createQueryBuilder.mockReturnValue(qb);
    packageRepository.find.mockResolvedValue([
      {
        id: 'ordered-package-id',
        services: [
          {
            id: 'hidden-purchased-service-id',
            name: 'Скрытая купленная услуга',
            description: 'Услуга из заказа',
            type: ServiceType.Service,
            price: 5000,
            giftEligible: false,
            isHidden: true,
            deletedAt: null,
          },
        ],
      },
    ]);
    orderItemRepository.find.mockResolvedValue([
      {
        orderId: 'order-id',
        packageId: 'ordered-package-id',
        subItems: [
          {
            serviceId: 'hidden-purchased-service-id',
            status: OrderStatus.Completed,
          },
        ],
      },
    ]);

    const result = await service.findAssignedToUserList(userId);

    expect(result[0].services).toEqual([
      expect.objectContaining({
        id: 'hidden-purchased-service-id',
        status: RecommendationStatus.Completed,
      }),
    ]);
  });

  it('keeps real UUIDs in public package coverage while hiding internal keys', () => {
    const { service } = createService();
    const result = callPrivate<GeneratedRecommendationItem>(
      service,
      'toPublicGeneratedRecommendationItem',
      {
        serviceId: null,
        packageId: 'package-id',
        serviceName: 'Пакет',
        priority: RecommendationPriority.Medium,
        rationale: 'package fit',
        diagnosticSignals: [],
        score: 10,
        coveredServiceIds: ['service-a', 'service-b'],
        coverageKeys: [
          'catalog_name:настройка crm',
          'catalog_semantic:crm_audit',
        ],
      },
    );

    expect(result.coveredServiceIds).toEqual(['service-a', 'service-b']);
    expect(result.coverageKeys).toBeUndefined();
  });

  it('replaces deleted package dependencies with the covering package', async () => {
    const { service, recommendationRepository } = createService();
    const serviceRow = (id: string, name: string) => ({
      id,
      name,
      description: name,
      type: ServiceType.Service,
      price: 1000,
      giftEligible: false,
      isHidden: false,
      deletedAt: null,
    });
    const smallPackage = {
      id: 'small-package-id',
      name: 'Малый пакет',
      isHidden: false,
      deletedAt: null,
      services: [serviceRow('crm-service-id', 'Настройка CRM')],
    };
    const largePackage = {
      id: 'large-package-id',
      name: 'Большой пакет',
      isHidden: false,
      deletedAt: null,
      services: [
        serviceRow('crm-service-id', 'Настройка CRM'),
        serviceRow('dashboard-service-id', 'Дашборд ОП'),
      ],
    };
    const smallRecommendation = {
      id: 'small-recommendation-id',
      userId,
      serviceId: null,
      packageId: smallPackage.id,
      package: smallPackage,
      status: RecommendationStatus.Recommended,
      source: RecommendationSource.AI,
      orderId: null,
      diagnosticSignals: [],
      dependencyIds: [],
    };
    const largeRecommendation = {
      id: 'large-recommendation-id',
      userId,
      serviceId: null,
      packageId: largePackage.id,
      package: largePackage,
      status: RecommendationStatus.Recommended,
      source: RecommendationSource.AI,
      orderId: null,
      diagnosticSignals: [],
      dependencyIds: [],
    };
    const dependentRecommendation = {
      id: 'dependent-recommendation-id',
      userId,
      serviceId: 'standalone-service-id',
      packageId: null,
      service: serviceRow('standalone-service-id', 'CRM аудит'),
      status: RecommendationStatus.Recommended,
      source: RecommendationSource.Manual,
      orderId: null,
      diagnosticSignals: [],
      dependencyIds: [smallRecommendation.id],
    };
    recommendationRepository.find.mockResolvedValue([
      smallRecommendation,
      largeRecommendation,
      dependentRecommendation,
    ]);

    await callPrivate<Promise<Set<string>>>(
      service,
      'compactReplaceableRecommendationSnapshot',
      userId,
    );

    expect(recommendationRepository.delete).toHaveBeenCalledWith([
      smallRecommendation.id,
    ]);
    expect(dependentRecommendation.dependencyIds).toEqual([
      largeRecommendation.id,
    ]);
  });

  it('rejects a replacement that would create a dependency cycle', async () => {
    const { service, recommendationRepository } = createService();
    const row = (id: string, dependencyIds: string[]) => ({
      id,
      userId,
      dependencyIds,
    });
    recommendationRepository.find.mockResolvedValue([
      row('package-p', ['recommendation-q']),
      row('recommendation-q', ['service-s']),
      row('service-s', []),
    ]);

    await expect(
      callPrivate<Promise<RecommendationDeletionTestResult>>(
        service,
        'deleteRecommendationIdsSafely',
        userId,
        ['service-s'],
        new Map([['service-s', 'package-p']]),
      ),
    ).rejects.toThrow(/dependency graph|cycle/);
    expect(recommendationRepository.delete).not.toHaveBeenCalled();
  });

  it('protects the transitive dependency closure before deleting recommendations', async () => {
    const { service, recommendationRepository } = createService();
    const row = (id: string, dependencyIds: string[]) => ({
      id,
      userId,
      dependencyIds,
    });
    recommendationRepository.find.mockResolvedValue([
      row('recommendation-a', ['recommendation-b']),
      row('recommendation-b', []),
      row('recommendation-c', ['recommendation-a']),
    ]);

    const result = await callPrivate<Promise<RecommendationDeletionTestResult>>(
      service,
      'deleteRecommendationIdsSafely',
      userId,
      ['recommendation-a', 'recommendation-b'],
      new Map(),
    );

    expect(result.deletedIds).toEqual([]);
    expect(result.blockedBy.get('recommendation-a')).toEqual([
      'recommendation-c',
    ]);
    expect(result.blockedBy.get('recommendation-b')).toEqual([
      'recommendation-a',
    ]);
    expect(recommendationRepository.delete).not.toHaveBeenCalled();
  });

  it('updates a protected recommendation when its deleted dependency is replaced', async () => {
    const { service, recommendationRepository } = createService();
    const row = (id: string, dependencyIds: string[]) => ({
      id,
      userId,
      dependencyIds,
    });
    const packageRecommendation = row('package-recommendation-id', [
      'service-recommendation-id',
    ]);
    recommendationRepository.find.mockResolvedValue([
      packageRecommendation,
      row('service-recommendation-id', []),
      row('covering-package-id', []),
      row('dependent-recommendation-id', [packageRecommendation.id]),
    ]);

    const result = await callPrivate<Promise<RecommendationDeletionTestResult>>(
      service,
      'deleteRecommendationIdsSafely',
      userId,
      ['package-recommendation-id', 'service-recommendation-id'],
      new Map([['service-recommendation-id', 'covering-package-id']]),
    );

    expect(result.deletedIds).toEqual(['service-recommendation-id']);
    expect(packageRecommendation.dependencyIds).toEqual([
      'covering-package-id',
    ]);
    expect(recommendationRepository.delete).toHaveBeenCalledWith([
      'service-recommendation-id',
    ]);
  });
  it('retries a generated insert through a savepoint after a unique conflict', async () => {
    const { service, recommendationRepository } = createService();
    const existing = {
      id: 'existing-recommendation-id',
      userId,
      serviceId: 'service-id',
      packageId: null,
    };
    const manager = {
      getRepository: jest.fn(() => recommendationRepository),
    };
    manager.transaction = jest.fn(
      async (callback: (manager: EntityManager) => unknown) =>
        callback(manager as unknown as EntityManager),
    );
    recommendationRepository.findOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(existing);
    recommendationRepository.save
      .mockRejectedValueOnce({ code: '23505' })
      .mockResolvedValueOnce(existing);

    const result = await callPrivate<Promise<unknown>>(
      service,
      'upsertGeneratedRecommendation',
      userId,
      {
        serviceId: 'service-id',
        packageId: null,
        serviceName: 'CRM',
        priority: RecommendationPriority.Medium,
        rationale: 'fit',
        diagnosticSignals: [],
        score: 50,
        coveredServiceIds: ['service-id'],
      },
      manager,
    );

    expect(result).toBe(existing);
    expect(manager.transaction).toHaveBeenCalledTimes(2);
  });

  it('replaces a legacy questionnaire row that was misclassified as manual', async () => {
    const { service, recommendationRepository } = createService();
    const existing = {
      id: 'legacy-questionnaire-recommendation-id',
      userId,
      serviceId: 'service-id',
      packageId: null,
      orderId: null,
      status: RecommendationStatus.Recommended,
      source: RecommendationSource.Manual,
      priority: RecommendationPriority.Low,
      rationale:
        'CRM Старт: рекомендация выбрана по анкете (CRM выбрана в анкете).',
      diagnosticSignals: [],
      generatedAt: null,
    };
    recommendationRepository.findOne.mockResolvedValue(existing);
    recommendationRepository.save.mockImplementation(
      async (recommendation) => recommendation,
    );

    const result = await callPrivate<Promise<Recommendation>>(
      service,
      'upsertGeneratedRecommendation',
      userId,
      {
        serviceId: 'service-id',
        packageId: null,
        serviceName: 'CRM',
        priority: RecommendationPriority.Urgent,
        rationale: 'new questionnaire result',
        diagnosticSignals: ['new_result'],
        score: 100,
        coveredServiceIds: ['service-id'],
      },
    );

    expect(result).toEqual(
      expect.objectContaining({
        source: RecommendationSource.AI,
        rationale: 'new questionnaire result',
        diagnosticSignals: ['new_result'],
      }),
    );
    expect(result.generatedAt).toBeInstanceOf(Date);
    expect(recommendationRepository.save).toHaveBeenCalledWith(existing);
  });

  it('uses order sub-item services when the live package composition changed', async () => {
    const {
      service,
      recommendationRepository,
      packageRepository,
      orderItemRepository,
    } = createService();
    const qb = {
      leftJoin: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue([
        {
          id: 'ordered-package-recommendation-id',
          serviceId: null,
          packageId: 'ordered-package-id',
          orderId: 'order-id',
          name: 'Заказанный пакет',
          description: 'Пакет',
          type: 'Пакет услуг',
          category: 'CRM',
          price: '10000',
          giftEligible: false,
          status: RecommendationStatus.Completed,
          priority: RecommendationPriority.Medium,
          rationale: null,
          dependencyIds: [],
          diagnosticSignals: [],
          createdAt: new Date(),
        },
      ]),
    };
    recommendationRepository.createQueryBuilder.mockReturnValue(qb);
    packageRepository.find.mockResolvedValue([
      { id: 'ordered-package-id', services: [] },
    ]);
    orderItemRepository.find.mockResolvedValue([
      {
        orderId: 'order-id',
        packageId: 'ordered-package-id',
        subItems: [
          {
            serviceId: 'removed-from-package-service-id',
            status: OrderStatus.Completed,
            service: {
              id: 'removed-from-package-service-id',
              name: 'Удалённая из состава услуга',
              description: 'Историческая услуга',
              type: ServiceType.Service,
              price: 5000,
              giftEligible: false,
              isHidden: true,
              deletedAt: null,
            },
          },
        ],
      },
    ]);

    const result = await service.findAssignedToUserList(userId);

    expect(result[0].services).toEqual([
      expect.objectContaining({
        id: 'removed-from-package-service-id',
        status: RecommendationStatus.Completed,
      }),
    ]);
  });

  it('returns a conflict instead of a false success when a dependency blocks deletion', async () => {
    const { service, recommendationRepository } = createService();
    recommendationRepository.findOne.mockResolvedValue({
      id: 'dependency-id',
      userId,
    });
    recommendationRepository.find.mockResolvedValue([
      { id: 'dependency-id', userId, dependencyIds: [] },
      { id: 'dependent-id', userId, dependencyIds: ['dependency-id'] },
    ]);

    await expect(service.removeForAdmin('dependency-id')).rejects.toThrow(
      'dependent-id',
    );
    expect(recommendationRepository.delete).not.toHaveBeenCalled();
  });
  it('rechecks recommendation coverage after acquiring the user lock', async () => {
    const { service, recommendationRepository, relevanceRanker } =
      createService();
    recommendationRepository.find.mockResolvedValue([
      {
        id: 'manual-package-recommendation-id',
        userId,
        serviceId: null,
        packageId: 'manual-package-id',
        status: RecommendationStatus.Recommended,
        source: RecommendationSource.Manual,
        orderId: null,
        package: {
          id: 'manual-package-id',
          services: [
            {
              id: 'service-id',
              name: 'CRM setup',
              isHidden: false,
              deletedAt: null,
            },
          ],
        },
      },
    ]);
    recommendationRepository.findOne.mockResolvedValue(null);
    relevanceRanker.rankRecommendations.mockReturnValue([
      {
        serviceId: 'service-id',
        packageId: null,
        serviceName: 'CRM setup',
        priority: RecommendationPriority.Urgent,
        rationale: 'fit',
        diagnosticSignals: [],
        score: 90,
        coveredServiceIds: ['service-id'],
        coverageKeys: ['catalog_name:crm setup'],
      },
    ]);

    const result = await service.generateForUser({ userId, persist: true });

    expect(result).toEqual([]);
    expect(recommendationRepository.create).not.toHaveBeenCalled();
  });

  it('does not prune a recommendation that checkout attached an order to', async () => {
    const { service, recommendationRepository } = createService();
    const purchasedRecommendation = {
      id: 'checked-out-recommendation-id',
      userId,
      status: RecommendationStatus.Recommended,
      source: RecommendationSource.AI,
      orderId: 'checkout-order-id',
      dependencyIds: [],
      diagnosticSignals: [],
    };
    recommendationRepository.find.mockResolvedValue([purchasedRecommendation]);
    const manager = {
      getRepository: jest.fn(() => recommendationRepository),
    };

    const result = await callPrivate<Promise<RecommendationDeletionTestResult>>(
      service,
      'deleteRecommendationIdsSafely',
      userId,
      [purchasedRecommendation.id],
      new Map(),
      manager,
      true,
    );

    expect(result.deletedIds).toEqual([]);
    expect(recommendationRepository.delete).not.toHaveBeenCalled();
  });
  it('updates user status from a fresh locked recommendation row', async () => {
    const { service, recommendationRepository, recommendationUserLockService } =
      createService();
    const recommendation = {
      id: 'status-recommendation-id',
      userId,
      status: RecommendationStatus.Recommended,
    };
    recommendationRepository.findOne.mockResolvedValue(recommendation);

    await service.updateForUser(userId, recommendation.id, {
      status: RecommendationStatus.Completed,
    });

    expect(recommendationUserLockService.lockUser).toHaveBeenCalledWith(
      userId,
      expect.anything(),
    );
    expect(recommendationRepository.findOne).toHaveBeenCalledWith({
      where: { id: recommendation.id, userId },
    });
    expect(recommendationRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        id: recommendation.id,
        status: RecommendationStatus.Completed,
      }),
    );
  });

  it('updates dependencies through the same user-locked transaction', async () => {
    const { service, recommendationRepository, recommendationUserLockService } =
      createService();
    const recommendation = {
      id: 'dependency-update-recommendation-id',
      userId,
      dependencyIds: [],
    };
    recommendationRepository.findOne.mockResolvedValue(recommendation);

    await service.updateDependenciesForAdmin(recommendation.id, []);

    expect(recommendationUserLockService.lockUser).toHaveBeenCalledWith(
      userId,
      expect.anything(),
    );
    expect(recommendationRepository.save).toHaveBeenCalledWith(recommendation);
  });

  it('re-reads the admin recommendation after locking before applying a patch', async () => {
    const { service, recommendationRepository, recommendationUserLockService } =
      createService();
    const snapshot = {
      id: 'admin-patch-recommendation-id',
      userId,
      status: RecommendationStatus.Recommended,
      rationale: 'stale snapshot',
    };
    const fresh = {
      ...snapshot,
      rationale: 'fresh row',
      priority: RecommendationPriority.Low,
    };
    recommendationRepository.findOne
      .mockResolvedValueOnce(snapshot)
      .mockResolvedValueOnce(fresh)
      .mockResolvedValue(fresh);

    await service.updateForAdmin(fresh.id, {
      rationale: 'new rationale',
    });

    expect(recommendationUserLockService.lockUser).toHaveBeenCalledWith(
      userId,
      expect.anything(),
    );
    expect(recommendationRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        id: fresh.id,
        rationale: 'new rationale',
        priority: RecommendationPriority.Low,
      }),
    );
  });
  it('rejects logically duplicate packages with equal coverage', async () => {
    const { service, recommendationRepository, packageRepository } =
      createService();
    const qb = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue(null),
    };
    recommendationRepository.createQueryBuilder.mockReturnValue(qb);
    const packageServices = [
      {
        id: 'crm-service-id',
        name: 'Настройка CRM',
        deletedAt: null,
        isHidden: false,
      },
      {
        id: 'dashboard-service-id',
        name: 'Дашборд ОП',
        deletedAt: null,
        isHidden: false,
      },
    ];
    const targetPackage = {
      id: 'logical-package-a',
      name: 'CRM расширенный',
      services: packageServices,
    };
    const existingPackage = {
      id: 'logical-package-b',
      name: 'CRM другой',
      services: packageServices,
    };
    packageRepository.findOne.mockResolvedValue(targetPackage);
    recommendationRepository.find.mockResolvedValue([
      {
        id: 'existing-package-recommendation-id',
        packageId: existingPackage.id,
        package: existingPackage,
      },
    ]);

    await expect(
      callPrivate<Promise<void>>(
        service,
        'ensureRecommendationIsUnique',
        userId,
        null,
        targetPackage.id,
      ),
    ).rejects.toThrow('equivalent package');
  });
  it('keeps hidden targets available in the admin recommendation list', async () => {
    const { service, recommendationRepository } = createService();
    const qb = {
      leftJoin: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue([
        {
          id: 'hidden-service-recommendation-id',
          serviceId: 'hidden-service-id',
          packageId: null,
          name: 'Скрытая услуга',
          category: '',
          price: '1000',
          status: RecommendationStatus.Completed,
          source: RecommendationSource.AI,
          priority: RecommendationPriority.Medium,
          rationale: null,
          dependencyIds: [],
          diagnosticSignals: [],
          createdAt: new Date(),
        },
      ]),
    };
    recommendationRepository.createQueryBuilder.mockReturnValue(qb);

    const result = await service.findAssignedToUserForAdmin(userId);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('hidden-service-recommendation-id');
    expect(qb.andWhere).not.toHaveBeenCalled();
  });

  it('does not hide a standalone recommendation behind a completed package', () => {
    const { service } = createService();
    const rows = [
      {
        id: 'completed-package-recommendation-id',
        packageId: 'completed-package-id',
        serviceId: null,
        status: RecommendationStatus.Completed,
      },
      {
        id: 'active-service-recommendation-id',
        packageId: null,
        serviceId: 'dashboard-id',
        status: RecommendationStatus.Recommended,
        name: 'Дашборд ОП',
      },
    ];
    const packages = [
      {
        id: 'completed-package-id',
        services: [
          {
            id: 'dashboard-id',
            name: 'Дашборд ОП',
            isHidden: false,
            deletedAt: null,
          },
        ],
      },
    ];

    const result = callPrivate<Array<{ id: string }>>(
      service,
      'filterPackageCoveredStandaloneRecommendations',
      rows,
      packages,
    );

    expect(result.map((row: { id: string }) => row.id)).toEqual([
      'completed-package-recommendation-id',
      'active-service-recommendation-id',
    ]);
  });

  it('hides standalone turnkey hiring covered by two-manager turnkey hiring', () => {
    const { service } = createService();
    const rows = [
      {
        id: 'from-zero-recommendation-id',
        packageId: 'from-zero-package-id',
        serviceId: null,
        status: RecommendationStatus.Recommended,
      },
      {
        id: 'turnkey-hiring-recommendation-id',
        packageId: null,
        serviceId: 'turnkey-hiring-service-id',
        status: RecommendationStatus.Recommended,
        name: '\u041f\u043e\u0434\u0431\u043e\u0440 \u043f\u043e\u0434 \u043a\u043b\u044e\u0447',
      },
    ];
    const packages = [
      {
        id: 'from-zero-package-id',
        services: [
          {
            id: 'two-manager-hiring-service-id',
            name: twoManagerTurnkeyHiringName,
            description: 'Full-cycle hiring of two sales managers',
            skills: [],
            category: null,
            isHidden: false,
            deletedAt: null,
          },
        ],
      },
    ];

    const result = callPrivate<Array<{ id: string }>>(
      service,
      'filterPackageCoveredStandaloneRecommendations',
      rows,
      packages,
    );

    expect(result.map((row: { id: string }) => row.id)).toEqual([
      'from-zero-recommendation-id',
    ]);
  });

  it('does not hide a different standalone hiring service', () => {
    const { service } = createService();
    const rows = [
      {
        id: 'from-zero-recommendation-id',
        packageId: 'from-zero-package-id',
        serviceId: null,
        status: RecommendationStatus.Recommended,
      },
      {
        id: 'candidate-search-recommendation-id',
        packageId: null,
        serviceId: 'candidate-search-service-id',
        status: RecommendationStatus.Recommended,
        name: 'Candidate search',
      },
    ];
    const packages = [
      {
        id: 'from-zero-package-id',
        services: [
          {
            id: 'two-manager-hiring-service-id',
            name: twoManagerTurnkeyHiringName,
            description: 'Full-cycle hiring of two sales managers',
            skills: [],
            category: null,
            isHidden: false,
            deletedAt: null,
          },
        ],
      },
    ];

    const result = callPrivate<Array<{ id: string }>>(
      service,
      'filterPackageCoveredStandaloneRecommendations',
      rows,
      packages,
    );

    expect(result.map((row: { id: string }) => row.id)).toEqual([
      'from-zero-recommendation-id',
      'candidate-search-recommendation-id',
    ]);
  });

  it('merges an explicit generation clientProfile from the demo page over saved answers', async () => {
    const { service, questionnaireRepository, generationJobService } =
      createService();
    const clientProfile = {
      productStage: 'new',
      targetRevenue: 5000000,
      components: { crm: false },
    };

    await service.startGenerationForUser(userId, {
      clientProfile,
      persist: true,
    });

    expect(questionnaireRepository.findOne).toHaveBeenCalledWith({
      where: { userId },
    });
    expect(generationJobService.startGenerationForUser).toHaveBeenCalledWith(
      userId,
      expect.objectContaining({
        clientProfile: {
          ...questionnaireAnswers,
          productStage: 'new',
          targetRevenue: 5000000,
          components: { crm: false, telephony: true },
        },
      }),
      expect.any(Function),
    );
  });

  it('keeps saved questionnaire fields when generation clientProfile is partial', async () => {
    const { service, generationJobService } = createService();

    await service.startGenerationForUser(userId, {
      clientProfile: { components: { crm: false } },
      persist: true,
    });

    expect(generationJobService.startGenerationForUser).toHaveBeenCalledWith(
      userId,
      expect.objectContaining({
        clientProfile: {
          ...questionnaireAnswers,
          components: { crm: false, telephony: true },
        },
      }),
      expect.any(Function),
    );
  });

  it('falls back to saved questionnaire answers when generation has no clientProfile', async () => {
    const { service, questionnaireRepository, generationJobService } =
      createService();

    await service.startGenerationForUser(userId, { persist: true });

    expect(questionnaireRepository.findOne).toHaveBeenCalledWith({
      where: { userId },
    });
    expect(generationJobService.startGenerationForUser).toHaveBeenCalledWith(
      userId,
      expect.objectContaining({ clientProfile: questionnaireAnswers }),
      expect.any(Function),
    );
  });

  it('uses saved questionnaire answers for direct generation without clientProfile', async () => {
    const { service, scoringService, relevanceRanker } = createService();

    await service.generateForUser({
      userId,
      persist: false,
    });

    expect(scoringService.buildDiagnosticContext).toHaveBeenCalledWith(
      expect.objectContaining({ clientProfile: questionnaireAnswers }),
    );
    expect(scoringService.generateAiRecommendations).toHaveBeenCalledWith(
      expect.objectContaining({ clientProfile: questionnaireAnswers }),
      [],
      'context',
    );
    expect(relevanceRanker.rankRecommendations).toHaveBeenCalledWith(
      expect.objectContaining({ clientProfile: questionnaireAnswers }),
      [],
      [],
      'context',
      undefined,
    );
  });

  it('keeps legacy package-category services in recommendation candidates alongside real packages', async () => {
    const { service, serviceRepository, packageRepository, relevanceRanker } =
      createService();
    const qb = createQueryBuilder();
    serviceRepository.createQueryBuilder.mockReturnValue(qb);
    qb.getMany.mockResolvedValue([
      {
        id: 'legacy-package-service-id',
        name: 'CRM Бронза',
        description: 'Базовый запуск CRM',
        type: ServiceType.Service,
        price: 60000,
        skills: ['crm бронза'],
        category: { name: 'Пакет услуг' },
      },
      {
        id: 'regular-service-id',
        name: 'Интеграция телефонии',
        description: 'Подключение звонков',
        type: ServiceType.Service,
        price: 20000,
        skills: ['телефония'],
        category: { name: 'CRM система' },
      },
    ]);
    packageRepository.find.mockResolvedValue([
      {
        id: 'real-package-id',
        name: 'CRM package',
        description: 'Package',
        price: 80000,
        tags: ['crm'],
        categoryId: 'category-id',
        category: { name: 'Пакет услуг' },
        services: [
          {
            id: 'regular-service-id',
            name: 'Интеграция телефонии',
            deletedAt: null,
            skills: ['телефония'],
            category: { name: 'CRM система' },
          },
        ],
        createdAt: new Date(),
        deletedAt: null,
      },
    ]);

    await service.generateForUser({
      userId,
      persist: false,
    });

    const candidates = relevanceRanker.rankRecommendations.mock.calls[0][1];
    expect(candidates.map((item) => item.packageId ?? item.serviceId)).toEqual(
      expect.arrayContaining([
        'real-package-id',
        'legacy-package-service-id',
        'regular-service-id',
      ]),
    );
  });

  it('deduplicates legacy package services by coverage key across UUIDs', async () => {
    const { service, serviceRepository, packageRepository, relevanceRanker } =
      createService();
    const qb = createQueryBuilder();
    serviceRepository.createQueryBuilder.mockReturnValue(qb);
    qb.getMany.mockResolvedValue([
      {
        id: 'legacy-dashboard-service-id',
        name: 'Дашборд ОП',
        description: 'Старая строка услуги',
        type: ServiceType.Service,
        price: 10000,
        skills: ['дашборд'],
        category: { name: 'Пакет услуг' },
      },
    ]);
    packageRepository.find.mockResolvedValue([
      {
        id: 'sales-package-id',
        name: 'Sales package',
        description: 'Полный пакет отдела продаж',
        price: 50000,
        tags: ['sales'],
        categoryId: 'category-id',
        category: { name: 'Пакет услуг' },
        services: [
          {
            id: 'canonical-dashboard-service-id',
            name: 'Дашборд ОП',
            description: 'Каноническая услуга в пакете',
            deletedAt: null,
            isHidden: false,
            skills: ['дашборд'],
            category: { name: 'Аналитика' },
          },
        ],
        createdAt: new Date(),
        deletedAt: null,
      },
    ]);

    await service.generateForUser({ userId, persist: false });

    const candidates = relevanceRanker.rankRecommendations.mock.calls[0][1];
    expect(candidates.map((item) => item.packageId ?? item.serviceId)).toEqual([
      'sales-package-id',
    ]);
  });
  it('adds inner service descriptions to package recommendation candidates', async () => {
    const { service, serviceRepository, packageRepository, relevanceRanker } =
      createService();
    const qb = createQueryBuilder();
    serviceRepository.createQueryBuilder.mockReturnValue(qb);
    qb.getMany.mockResolvedValue([]);
    packageRepository.find.mockResolvedValue([
      {
        id: 'real-package-id',
        name: 'CRM Пакет',
        description: '',
        packageType: 'bronze',
        price: 80000,
        tags: [],
        categoryId: 'category-id',
        category: { name: 'Пакет услуг' },
        services: [
          {
            id: 'inner-service-id',
            name: 'Настройка CRM',
            description: 'Аудит, воронки, роботы и статусы отказа',
            deletedAt: null,
            skills: ['crm'],
            category: { name: 'CRM система' },
          },
        ],
        createdAt: new Date(),
        deletedAt: null,
      },
    ]);

    await service.generateForUser({
      userId,
      persist: false,
    });

    const candidates = relevanceRanker.rankRecommendations.mock.calls[0][1];
    const packageCandidate = candidates.find(
      (item) => item.packageId === 'real-package-id',
    );
    expect(packageCandidate.description).toContain(
      'Аудит, воронки, роботы и статусы отказа',
    );
  });

  it('uses the real CRM Start composition from the catalog', async () => {
    const { service, serviceRepository, packageRepository, relevanceRanker } =
      createService();
    const qb = createQueryBuilder();
    serviceRepository.createQueryBuilder.mockReturnValue(qb);
    qb.getMany.mockResolvedValue([]);
    const crmStartServices = [
      {
        id: 'da4c0e35-54a8-41f4-88a7-78e43c0ae5be',
        name: 'Интеграция мессенджера',
        description: 'Подключение мессенджеров к CRM',
        deletedAt: null,
        skills: ['crm', 'мессенджер'],
        category: { name: 'CRM система' },
      },
      {
        id: '59f1273e-fff8-49da-9553-776579985660',
        name: 'Интеграция почты',
        description: 'Подключение почты к CRM',
        deletedAt: null,
        skills: ['crm', 'почта'],
        category: { name: 'CRM система' },
      },
      {
        id: '3dd98b30-1d7c-4c99-b8bd-0bb8cfcbcaca',
        name: 'Интеграция телефонии',
        description: 'Подключение телефонии к CRM',
        deletedAt: null,
        skills: ['crm', 'телефония'],
        category: { name: 'CRM система' },
      },
    ];
    packageRepository.find.mockResolvedValue([
      {
        id: '292a8ec3-ea07-4326-9bb8-fed6056b3b20',
        name: 'CRM Старт',
        description:
          'Базовый стартовый пакет CRM: телефония, мессенджер, почта.',
        packageType: 'Старт',
        price: 20000,
        tags: ['CRM', 'Старт', 'Интеграции'],
        categoryId: 'category-id',
        category: { name: 'CRM система' },
        services: crmStartServices,
        createdAt: new Date(),
        deletedAt: null,
      },
    ]);

    await service.generateForUser({ userId, persist: false });

    const candidates = relevanceRanker.rankRecommendations.mock.calls[0][1];
    const crmStart = candidates.find(
      (item) => item.packageId === '292a8ec3-ea07-4326-9bb8-fed6056b3b20',
    );
    expect(crmStart.coverageKeys).toEqual(
      expect.arrayContaining([
        'catalog_name:интеграция мессенджера',
        'catalog_name:интеграция почты',
        'catalog_name:интеграция телефонии',
      ]),
    );
  });

  it('canonicalizes duplicate same-name package services before global deduplication', () => {
    const { service } = createService();
    const duplicateServices = [
      { id: 'dashboard-uuid-1', name: 'Дашборд ОП', deletedAt: null },
      { id: 'dashboard-uuid-2', name: 'Дашборд ОП', deletedAt: null },
    ];
    const canonicalService = {
      id: 'canonical-dashboard-id',
      name: 'Дашборд ОП',
      deletedAt: null,
    };

    const getCoverage = (services: unknown[]) =>
      callPrivate<string[]>(service, 'getPackageCoverageIds', services);

    expect(getCoverage(duplicateServices)).toEqual(['catalog_name:дашборд оп']);
    expect(getCoverage([canonicalService])).toEqual([
      'catalog_name:дашборд оп',
    ]);
  });
  it('keeps only the fuller package when catalog names are duplicated', async () => {
    const { service, serviceRepository, packageRepository, relevanceRanker } =
      createService();
    const qb = createQueryBuilder();
    serviceRepository.createQueryBuilder.mockReturnValue(qb);
    qb.getMany.mockResolvedValue([]);

    const recruitment = {
      id: 'recruitment-service-id',
      name: 'Подбор менеджеров',
      description: 'Подбор команды продаж',
      isHidden: false,
      deletedAt: null,
      skills: ['подбор'],
      category: { name: 'Отдел продаж' },
    };
    const crmSetup = {
      id: 'crm-setup-service-id',
      name: 'Настройка CRM',
      description: 'Настройка системы продаж',
      isHidden: false,
      deletedAt: null,
      skills: ['crm'],
      category: { name: 'CRM система' },
    };
    packageRepository.find.mockResolvedValue([
      {
        id: 'obsolete-package-id',
        name: 'Отдел продаж с нуля',
        description: 'Устаревший пакет',
        price: 10000,
        tags: ['продажи'],
        categories: [],
        services: [recruitment],
        isHidden: false,
        createdAt: new Date('2025-01-01T00:00:00Z'),
        deletedAt: null,
      },
      {
        id: 'complete-package-id',
        name: 'Отдел продаж с нуля',
        description: 'Полный пакет',
        price: 100000,
        tags: ['продажи', 'crm'],
        categories: [],
        services: [recruitment, crmSetup],
        isHidden: false,
        createdAt: new Date('2026-01-01T00:00:00Z'),
        deletedAt: null,
      },
    ]);

    await service.generateForUser({ userId, persist: false });

    const candidates = relevanceRanker.rankRecommendations.mock.calls[0][1];
    const matchingPackages = candidates.filter(
      (candidate) => candidate.name === 'Отдел продаж с нуля',
    );
    expect(matchingPackages).toHaveLength(1);
    expect(matchingPackages[0]).toEqual(
      expect.objectContaining({
        packageId: 'complete-package-id',
        coverageKeys: expect.arrayContaining([
          'catalog_name:подбор менеджеров',
          'catalog_name:настройка crm',
        ]),
      }),
    );
  });

  it('prefers the registered package ID over a fuller duplicate', () => {
    const { service } = createService();
    const serviceItem = (id: string) => ({
      id,
      name: id,
      isHidden: false,
      deletedAt: null,
    });
    const registeredPackage = {
      id: RECOMMENDATION_CATALOG.salesDepartmentFromZero.id,
      name: 'Отдел продаж с нуля',
      services: [serviceItem('registered-service')],
      createdAt: new Date('2025-01-01T00:00:00Z'),
    };
    const fullerDuplicate = {
      id: 'fuller-duplicate-package-id',
      name: 'Отдел продаж с нуля',
      services: [
        serviceItem('duplicate-service-1'),
        serviceItem('duplicate-service-2'),
      ],
      createdAt: new Date('2026-01-01T00:00:00Z'),
    };

    const result = callPrivate<Array<{ id: string }>>(
      service,
      'deduplicatePackagesByName',
      [fullerDuplicate, registeredPackage],
    );

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(
      RECOMMENDATION_CATALOG.salesDepartmentFromZero.id,
    );
  });

  it('adds logical duplicate services to package coverage', async () => {
    const { service, serviceRepository, packageRepository, relevanceRanker } =
      createService();
    const qb = createQueryBuilder();
    serviceRepository.createQueryBuilder.mockReturnValue(qb);
    qb.getMany.mockResolvedValue([
      {
        id: 'tech-spec-service-id',
        name: 'Подготовка технического задания',
        description: 'Детальный план настройки CRM',
        type: ServiceType.Document,
        price: 20000,
        skills: ['crm', 'техническое задание'],
        category: { name: 'CRM система' },
        deletedAt: null,
      },
      {
        id: 'crm-audit-service-id',
        name: 'Аудит CRM',
        description: 'Диагностика CRM и процессов продаж',
        type: ServiceType.Service,
        price: 7000,
        skills: ['crm', 'аудит'],
        category: { name: 'CRM система' },
        deletedAt: null,
      },
      {
        id: 'dashboard-service-id',
        name: 'Дашборд ОП',
        description: 'Панель с ключевыми показателями отдела продаж',
        type: ServiceType.Document,
        price: 10000,
        skills: ['дашборд оп', 'аналитика'],
        category: { name: 'Документы' },
        deletedAt: null,
      },
      {
        id: 'instruction-service-id',
        name: 'Рабочая инструкция МП',
        description: 'Описание правил работы менеджера',
        type: ServiceType.Document,
        price: 1000,
        skills: ['документы'],
        category: { name: 'Документы' },
        deletedAt: null,
      },
    ]);
    packageRepository.find.mockResolvedValue([
      {
        id: 'crm-silver-package-id',
        name: 'CRM Серебро',
        description: 'Расширенная настройка CRM: аудит, подготовка ТЗ',
        packageType: 'silver',
        price: 100000,
        tags: ['crm'],
        categoryId: 'category-id',
        category: { name: 'Пакет услуг' },
        services: [
          {
            id: 'inner-tz-service-id',
            name: 'Подготовка ТЗ',
            description: 'ТЗ для настройки CRM',
            deletedAt: null,
            skills: ['тз'],
            category: { name: 'CRM система' },
          },
        ],
        createdAt: new Date(),
        deletedAt: null,
      },
      {
        id: 'documents-package-id',
        name: 'Пакет документов отдела продаж',
        description: 'Комплект документов и дашборд ОП',
        packageType: 'documents',
        price: 25000,
        tags: ['документы'],
        categoryId: 'category-id',
        category: { name: 'Пакет услуг' },
        services: [
          {
            id: 'instruction-service-id',
            name: 'Рабочая инструкция МП',
            description: 'Описание правил работы менеджера',
            deletedAt: null,
            skills: ['документы'],
            category: { name: 'Документы' },
          },
        ],
        createdAt: new Date(),
        deletedAt: null,
      },
    ]);

    await service.generateForUser({
      userId,
      persist: false,
    });

    const candidates = relevanceRanker.rankRecommendations.mock.calls[0][1];
    const packageCandidate = candidates.find(
      (item) => item.packageId === 'crm-silver-package-id',
    );
    expect(packageCandidate.coverageKeys).toEqual(
      expect.arrayContaining(['catalog_name:подготовка тз']),
    );
    expect(packageCandidate.coverageKeys).not.toEqual(
      expect.arrayContaining(['tech-spec-service-id', 'crm-audit-service-id']),
    );
    const documentsPackageCandidate = candidates.find(
      (item) => item.packageId === 'documents-package-id',
    );
    expect(documentsPackageCandidate.coverageKeys).toEqual(
      expect.arrayContaining(['catalog_name:рабочая инструкция мп']),
    );
    expect(documentsPackageCandidate.coveredServiceIds).not.toContain(
      'dashboard-service-id',
    );
  });

  it('does not treat an incomplete hiring bundle as turnkey hiring coverage', async () => {
    const { service, serviceRepository, packageRepository, relevanceRanker } =
      createService();
    const qb = createQueryBuilder();
    serviceRepository.createQueryBuilder.mockReturnValue(qb);
    qb.getMany.mockResolvedValue([
      {
        id: 'turnkey-hiring-service-id',
        name: 'Подбор под ключ',
        description: 'Полный цикл найма менеджера по продажам',
        type: ServiceType.Service,
        price: 90000,
        skills: ['подбор'],
        category: { name: 'HR' },
        deletedAt: null,
      },
    ]);
    packageRepository.find.mockResolvedValue([
      {
        id: 'partial-hiring-package-id',
        name: 'РОП-Фокус',
        description: 'Профиль вакансии, портрет соискателя и скрининг',
        packageType: 'hr',
        price: 120000,
        tags: ['профиль вакансии', 'портрет соискателя', 'скрининг'],
        categoryId: 'category-id',
        category: { name: 'Пакет услуг' },
        services: [
          {
            id: 'profile-service-id',
            name: 'Профиль вакансии',
            description: '',
            deletedAt: null,
            skills: [],
            category: { name: 'HR' },
          },
          {
            id: 'portrait-service-id',
            name: 'Портрет соискателя',
            description: '',
            deletedAt: null,
            skills: [],
            category: { name: 'HR' },
          },
          {
            id: 'screening-service-id',
            name: 'Скрининг',
            description: '',
            deletedAt: null,
            skills: [],
            category: { name: 'HR' },
          },
        ],
        createdAt: new Date(),
        deletedAt: null,
      },
    ]);

    await service.generateForUser({
      userId,
      persist: false,
    });

    const candidates = relevanceRanker.rankRecommendations.mock.calls[0][1];
    const packageCandidate = candidates.find(
      (item) => item.packageId === 'partial-hiring-package-id',
    );
    expect(packageCandidate.coveredServiceIds).not.toContain(
      'turnkey-hiring-service-id',
    );
  });

  it('skips empty placeholder legacy package-category services', async () => {
    const { service, serviceRepository, relevanceRanker } = createService();
    const qb = createQueryBuilder();
    serviceRepository.createQueryBuilder.mockReturnValue(qb);
    qb.getMany.mockResolvedValue([
      {
        id: 'empty-test-package-service-id',
        name: 'Тестовый пакет',
        description: '',
        type: ServiceType.Service,
        price: 425353,
        skills: [],
        category: { name: 'Пакет услуг' },
      },
      {
        id: 'regular-service-id',
        name: 'Интеграция телефонии',
        description: 'Подключение звонков',
        type: ServiceType.Service,
        price: 20000,
        skills: ['телефония'],
        category: { name: 'CRM система' },
      },
    ]);

    await service.generateForUser({
      userId,
      persist: false,
    });

    const candidates = relevanceRanker.rankRecommendations.mock.calls[0][1];
    expect(candidates.map((item) => item.serviceId)).not.toContain(
      'empty-test-package-service-id',
    );
    expect(candidates.map((item) => item.serviceId)).toContain(
      'regular-service-id',
    );
  });

  it('skips placeholder legacy package-category services even when they have content', async () => {
    const { service, serviceRepository, relevanceRanker } = createService();
    const qb = createQueryBuilder();
    serviceRepository.createQueryBuilder.mockReturnValue(qb);
    qb.getMany.mockResolvedValue([
      {
        id: 'test-package-service-id',
        name: 'Тестовый пакет',
        description: 'CRM и настройка воронок',
        type: ServiceType.Service,
        price: 425353,
        skills: ['crm'],
        category: { name: 'Пакет услуг' },
      },
    ]);

    await service.generateForUser({
      userId,
      persist: false,
    });

    const candidates = relevanceRanker.rankRecommendations.mock.calls[0][1];
    expect(candidates.map((item) => item.serviceId)).not.toContain(
      'test-package-service-id',
    );
  });

  it('skips placeholder regular service candidates regardless of category', async () => {
    const { service, serviceRepository, relevanceRanker } = createService();
    const qb = createQueryBuilder();
    serviceRepository.createQueryBuilder.mockReturnValue(qb);
    qb.getMany.mockResolvedValue([
      {
        id: 'test-package-service-id',
        name: 'Тестовый пакет',
        description: 'CRM и настройка воронок',
        type: ServiceType.Service,
        price: 425353,
        skills: ['crm'],
        category: { name: 'CRM система' },
      },
      {
        id: 'regular-service-id',
        name: 'Интеграция телефонии',
        description: 'Подключение звонков',
        type: ServiceType.Service,
        price: 20000,
        skills: ['телефония'],
        category: { name: 'CRM система' },
      },
    ]);

    await service.generateForUser({
      userId,
      persist: false,
    });

    const candidates = relevanceRanker.rankRecommendations.mock.calls[0][1];
    expect(candidates.map((item) => item.serviceId)).not.toContain(
      'test-package-service-id',
    );
    expect(candidates.map((item) => item.serviceId)).toContain(
      'regular-service-id',
    );
  });

  it('deduplicates equal catalog names and prefers the service variant', async () => {
    const { service, serviceRepository, relevanceRanker } = createService();
    const qb = createQueryBuilder();
    serviceRepository.createQueryBuilder.mockReturnValue(qb);
    qb.getMany.mockResolvedValue([
      {
        id: 'technical-spec-document-id',
        name: 'Подготовка технического задания',
        description: 'Детальный план настройки CRM',
        type: ServiceType.Document,
        price: 20000,
        skills: ['crm', 'тз'],
        category: { name: 'CRM система' },
      },
      {
        id: 'technical-spec-service-id',
        name: 'Подготовка технического задания',
        description: 'Формирование плана внедрения CRM',
        type: ServiceType.Service,
        price: 20000,
        skills: ['crm', 'тз'],
        category: { name: 'CRM система' },
      },
    ]);

    await service.generateForUser({ userId, persist: false });

    const candidates = relevanceRanker.rankRecommendations.mock.calls[0][1];
    expect(candidates.map((item) => item.serviceId)).toEqual([
      'technical-spec-service-id',
    ]);
  });

  it('keeps the registered catalog ID when duplicate service names exist', async () => {
    const { service, serviceRepository, relevanceRanker } = createService();
    const qb = createQueryBuilder();
    serviceRepository.createQueryBuilder.mockReturnValue(qb);
    qb.getMany.mockResolvedValue([
      {
        id: 'duplicate-sales-head-id',
        name: 'Руководитель отдела продаж',
        description: 'Дублирующая позиция из каталога',
        type: ServiceType.Service,
        price: 0,
        skills: ['роп'],
        category: { name: 'Эксперты' },
      },
      {
        id: RECOMMENDATION_CATALOG.salesHead.id,
        name: 'Руководитель отдела продаж',
        description: 'Зарегистрированная позиция из каталога рекомендаций',
        type: ServiceType.Service,
        price: 0,
        skills: ['роп'],
        category: { name: 'Эксперты' },
      },
    ]);

    await service.generateForUser({ userId, persist: false });

    const candidates = relevanceRanker.rankRecommendations.mock.calls[0][1];
    expect(candidates.map((item) => item.serviceId)).toEqual([
      RECOMMENDATION_CATALOG.salesHead.id,
    ]);
  });

  it('skips placeholder real package candidates without own description or tags', async () => {
    const { service, serviceRepository, packageRepository, relevanceRanker } =
      createService();
    const qb = createQueryBuilder();
    serviceRepository.createQueryBuilder.mockReturnValue(qb);
    qb.getMany.mockResolvedValue([]);
    packageRepository.find.mockResolvedValue([
      {
        id: 'placeholder-package-id',
        name: 'Тестовый пакет',
        description: '',
        packageType: 'custom',
        price: 425353,
        tags: [],
        categoryId: 'category-id',
        category: { name: 'Пакет услуг' },
        services: [
          {
            id: 'inner-service-id',
            name: 'Настройка CRM',
            description: 'Аудит, воронки, роботы и статусы отказа',
            deletedAt: null,
            skills: ['crm'],
            category: { name: 'CRM система' },
          },
        ],
        createdAt: new Date(),
        deletedAt: null,
      },
    ]);

    await service.generateForUser({
      userId,
      persist: false,
    });

    const candidates = relevanceRanker.rankRecommendations.mock.calls[0][1];
    expect(candidates.map((item) => item.packageId)).not.toContain(
      'placeholder-package-id',
    );
  });

  it('skips placeholder real package candidates even when they have content', async () => {
    const { service, serviceRepository, packageRepository, relevanceRanker } =
      createService();
    const qb = createQueryBuilder();
    serviceRepository.createQueryBuilder.mockReturnValue(qb);
    qb.getMany.mockResolvedValue([]);
    packageRepository.find.mockResolvedValue([
      {
        id: 'placeholder-package-id',
        name: 'Тестовый пакет',
        description: 'CRM и настройка воронок',
        packageType: 'custom',
        price: 425353,
        tags: ['crm'],
        categoryId: 'category-id',
        category: { name: 'Пакет услуг' },
        services: [
          {
            id: 'inner-service-id',
            name: 'Настройка CRM',
            description: 'Аудит, воронки, роботы и статусы отказа',
            deletedAt: null,
            skills: ['crm'],
            category: { name: 'CRM система' },
          },
        ],
        createdAt: new Date(),
        deletedAt: null,
      },
    ]);

    await service.generateForUser({
      userId,
      persist: false,
    });

    const candidates = relevanceRanker.rankRecommendations.mock.calls[0][1];
    expect(candidates.map((item) => item.packageId)).not.toContain(
      'placeholder-package-id',
    );
  });

  it('skips legacy package-category services that duplicate real package candidates', async () => {
    const { service, serviceRepository, packageRepository, relevanceRanker } =
      createService();
    const qb = createQueryBuilder();
    serviceRepository.createQueryBuilder.mockReturnValue(qb);
    qb.getMany.mockResolvedValue([
      {
        id: 'legacy-package-service-id',
        name: 'CRM Бронза',
        description: 'Базовый запуск CRM',
        type: ServiceType.Service,
        price: 60000,
        skills: ['crm бронза'],
        category: { name: 'Пакет услуг' },
      },
      {
        id: 'regular-service-id',
        name: 'Интеграция телефонии',
        description: 'Подключение звонков',
        type: ServiceType.Service,
        price: 20000,
        skills: ['телефония'],
        category: { name: 'CRM система' },
      },
    ]);
    packageRepository.find.mockResolvedValue([
      {
        id: 'real-package-id',
        name: 'CRM Бронза',
        description: 'Package',
        price: 80000,
        tags: ['crm'],
        categoryId: 'category-id',
        category: { name: 'Пакет услуг' },
        services: [
          {
            id: 'regular-service-id',
            name: 'Интеграция телефонии',
            deletedAt: null,
            skills: ['телефония'],
            category: { name: 'CRM система' },
          },
        ],
        createdAt: new Date(),
        deletedAt: null,
      },
    ]);

    await service.generateForUser({
      userId,
      persist: false,
    });

    const candidates = relevanceRanker.rankRecommendations.mock.calls[0][1];
    expect(candidates.map((item) => item.packageId ?? item.serviceId)).toEqual(
      expect.arrayContaining(['real-package-id', 'regular-service-id']),
    );
    expect(candidates.map((item) => item.serviceId)).not.toContain(
      'legacy-package-service-id',
    );
  });

  it('removes a service recommendation when a selected package already covers it', async () => {
    const { service, relevanceRanker } = createService();
    relevanceRanker.rankRecommendations.mockReturnValue([
      {
        serviceId: null,
        packageId: 'package-id',
        serviceName: 'CRM package',
        priority: 'urgent',
        rationale: 'package fit',
        diagnosticSignals: [],
        score: 30,
        coveredServiceIds: ['service-id'],
      },
      {
        serviceId: 'service-id',
        packageId: null,
        serviceName: 'CRM setup',
        priority: 'medium',
        rationale: 'service fit',
        diagnosticSignals: [],
        score: 25,
        coveredServiceIds: ['service-id'],
      },
    ]);

    const result = await service.generateForUser({
      userId,
      persist: false,
    });

    expect(result.map((item) => item.packageId ?? item.serviceId)).toEqual([
      'package-id',
    ]);
  });

  it('removes a service recommendation when a selected package covers it semantically', async () => {
    const { service, relevanceRanker } = createService();
    relevanceRanker.rankRecommendations.mockReturnValue([
      {
        serviceId: null,
        packageId: 'crm-silver-package-id',
        serviceName: 'CRM Серебро',
        priority: 'urgent',
        rationale: 'package fit',
        diagnosticSignals: [],
        score: 30,
        coveredServiceIds: ['tech-spec-service-id'],
      },
      {
        serviceId: 'tech-spec-service-id',
        packageId: null,
        serviceName: 'Подготовка технического задания',
        priority: 'medium',
        rationale: 'service fit',
        diagnosticSignals: [],
        score: 25,
        coveredServiceIds: ['tech-spec-service-id'],
      },
    ]);

    const result = await service.generateForUser({
      userId,
      persist: false,
    });

    expect(result.map((item) => item.packageId ?? item.serviceId)).toEqual([
      'crm-silver-package-id',
    ]);
    expect(result[0].coveredServiceIds).toEqual(['tech-spec-service-id']);
  });

  it('does not let replaceable existing package coverage affect new selection', async () => {
    const { service, recommendationRepository, relevanceRanker } =
      createService();
    recommendationRepository.find.mockResolvedValue([
      {
        serviceId: null,
        packageId: 'package-id',
        status: RecommendationStatus.Recommended,
        orderId: null,
        package: {
          services: [{ id: 'service-id', deletedAt: null }],
        },
      },
    ]);
    relevanceRanker.rankRecommendations.mockReturnValue([
      {
        serviceId: 'service-id',
        packageId: null,
        serviceName: 'CRM setup',
        priority: 'urgent',
        rationale: 'service fit',
        diagnosticSignals: [],
        score: 30,
        coveredServiceIds: ['service-id'],
      },
      {
        serviceId: null,
        packageId: 'package-id',
        serviceName: 'CRM package',
        priority: 'medium',
        rationale: 'package fit',
        diagnosticSignals: [],
        score: 25,
        coveredServiceIds: ['service-id'],
      },
    ]);

    const result = await service.generateForUser({
      userId,
      persist: false,
    });

    expect(result.map((item) => item.packageId ?? item.serviceId)).toEqual([
      'package-id',
    ]);
  });

  it('allows a generated package to replace an older generated service recommendation', async () => {
    const { service, recommendationRepository, relevanceRanker } =
      createService();
    recommendationRepository.find.mockResolvedValue([
      {
        id: 'old-service-recommendation-id',
        serviceId: 'service-id',
        packageId: null,
        status: RecommendationStatus.Recommended,
        generatedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    ]);
    relevanceRanker.rankRecommendations.mockReturnValue([
      {
        serviceId: null,
        packageId: 'package-id',
        serviceName: 'CRM package',
        priority: 'medium',
        rationale: 'package fit',
        diagnosticSignals: [],
        score: 30,
        coveredServiceIds: ['service-id', 'service-b'],
      },
    ]);

    const result = await service.generateForUser({
      userId,
      persist: false,
    });

    expect(result.map((item) => item.packageId ?? item.serviceId)).toEqual([
      'package-id',
    ]);
  });

  it('keeps a manual recommended service without generatedAt', async () => {
    const { service, recommendationRepository, relevanceRanker } =
      createService();
    recommendationRepository.find.mockResolvedValue([
      {
        id: 'manual-service-recommendation-id',
        serviceId: 'service-id',
        packageId: null,
        status: RecommendationStatus.Recommended,
        source: RecommendationSource.Manual,
        generatedAt: null,
        orderId: null,
      },
    ]);
    relevanceRanker.rankRecommendations.mockReturnValue([
      {
        serviceId: null,
        packageId: 'package-id',
        serviceName: 'CRM package',
        priority: 'medium',
        rationale: 'package fit',
        diagnosticSignals: [],
        score: 30,
        coveredServiceIds: ['service-id', 'service-b'],
      },
    ]);

    const result = await service.generateForUser({
      userId,
      persist: false,
    });

    expect(result).toEqual([]);
  });

  it('does not let a legacy questionnaire row block current package coverage', async () => {
    const { service, recommendationRepository, relevanceRanker } =
      createService();
    recommendationRepository.find.mockResolvedValue([
      {
        id: 'legacy-questionnaire-recommendation-id',
        serviceId: 'service-id',
        packageId: null,
        status: RecommendationStatus.Recommended,
        source: RecommendationSource.Manual,
        rationale:
          'CRM Старт: рекомендация выбрана по анкете (CRM выбрана в анкете).',
        diagnosticSignals: [],
        generatedAt: null,
        orderId: null,
      },
    ]);
    relevanceRanker.rankRecommendations.mockReturnValue([
      {
        serviceId: null,
        packageId: 'package-id',
        serviceName: 'Current package',
        priority: RecommendationPriority.Urgent,
        rationale: 'current questionnaire result',
        diagnosticSignals: [],
        score: 100,
        coveredServiceIds: ['service-id', 'service-b'],
      },
    ]);

    const result = await service.generateForUser({
      userId,
      persist: false,
    });

    expect(result.map((item) => item.packageId ?? item.serviceId)).toEqual([
      'package-id',
    ]);
  });

  it('lets a training package replace a legacy questionnaire child', async () => {
    const { service, recommendationRepository, relevanceRanker } =
      createService();
    recommendationRepository.find.mockResolvedValue([
      {
        id: 'legacy-training-plan-recommendation-id',
        serviceId: 'training-plan-service-id',
        packageId: null,
        status: RecommendationStatus.Recommended,
        source: RecommendationSource.Manual,
        rationale: null,
        diagnosticSignals: [],
        generatedAt: new Date('2026-06-19T10:00:00.000Z'),
        orderId: null,
      },
    ]);
    relevanceRanker.rankRecommendations.mockReturnValue([
      {
        serviceId: null,
        packageId: 'training-three-months-package-id',
        serviceName: 'Training package for three months',
        priority: RecommendationPriority.Urgent,
        rationale: 'systematic preparation of a new team',
        diagnosticSignals: [],
        score: 122,
        coveredServiceIds: [
          'training-plan-service-id',
          'training-service-id',
          'training-exercise-service-id',
        ],
      },
    ]);

    const result = await service.generateForUser({
      userId,
      persist: false,
    });

    expect(result.map((item) => item.packageId ?? item.serviceId)).toEqual([
      'training-three-months-package-id',
    ]);
  });

  it('keeps manual coverage from being replaced by a generated package', async () => {
    const { service, recommendationRepository, relevanceRanker } =
      createService();
    const replacedManualRecommendation = {
      id: 'manual-service-recommendation-id',
      serviceId: 'service-id',
      packageId: null,
      status: RecommendationStatus.Recommended,
      source: RecommendationSource.Manual,
      generatedAt: null,
      orderId: null,
    };
    const unrelatedManualRecommendation = {
      id: 'unrelated-manual-recommendation-id',
      serviceId: 'unrelated-service-id',
      packageId: null,
      status: RecommendationStatus.Recommended,
      source: RecommendationSource.Manual,
      generatedAt: null,
      orderId: null,
    };
    const manualRecommendations = [
      replacedManualRecommendation,
      unrelatedManualRecommendation,
    ];
    recommendationRepository.find
      .mockResolvedValueOnce(manualRecommendations)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(manualRecommendations);
    recommendationRepository.findOne.mockResolvedValue(null);
    relevanceRanker.rankRecommendations.mockReturnValue([
      {
        serviceId: null,
        packageId: 'package-id',
        serviceName: 'CRM package',
        priority: 'medium',
        rationale: 'package fit',
        diagnosticSignals: [],
        score: 30,
        coveredServiceIds: ['service-id', 'service-b'],
      },
    ]);

    const result = await service.generateForUser({
      userId,
      persist: true,
    });

    expect(result).toEqual([]);
    expect(recommendationRepository.delete).not.toHaveBeenCalled();
  });

  it('keeps manual package coverage from being replaced by a child service', async () => {
    const { service, recommendationRepository, relevanceRanker } =
      createService();
    const manualPackageRecommendation = {
      id: 'manual-package-recommendation-id',
      serviceId: null,
      packageId: 'manual-package-id',
      status: RecommendationStatus.Recommended,
      source: RecommendationSource.Manual,
      generatedAt: null,
      orderId: null,
      package: {
        name: 'Manual package',
        description: null,
        packageType: 'custom',
        category: null,
        tags: [],
        services: [
          {
            id: 'service-a',
            name: 'Service A',
            description: null,
            category: null,
            skills: [],
            deletedAt: null,
          },
          {
            id: 'service-b',
            name: 'Service B',
            description: null,
            category: null,
            skills: [],
            deletedAt: null,
          },
        ],
      },
    };
    recommendationRepository.find
      .mockResolvedValueOnce([manualPackageRecommendation])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([manualPackageRecommendation]);
    recommendationRepository.findOne.mockResolvedValue(null);
    relevanceRanker.rankRecommendations.mockReturnValue([
      {
        serviceId: 'service-a',
        packageId: null,
        serviceName: 'Service A',
        priority: 'medium',
        rationale: 'partial package match',
        diagnosticSignals: [],
        score: 30,
        coveredServiceIds: ['service-a', 'catalog_name:service a'],
      },
    ]);

    const result = await service.generateForUser({
      userId,
      persist: true,
    });

    expect(result).toEqual([]);
    expect(recommendationRepository.delete).not.toHaveBeenCalled();
  });

  it('keeps recommendations linked to an order from being replaced by overlapping packages', async () => {
    const { service, recommendationRepository, relevanceRanker } =
      createService();
    recommendationRepository.find.mockResolvedValue([
      {
        id: 'purchased-service-recommendation-id',
        serviceId: 'service-id',
        packageId: null,
        status: RecommendationStatus.Recommended,
        generatedAt: null,
        orderId: 'order-id',
      },
    ]);
    relevanceRanker.rankRecommendations.mockReturnValue([
      {
        serviceId: null,
        packageId: 'package-id',
        serviceName: 'CRM package',
        priority: 'medium',
        rationale: 'package fit',
        diagnosticSignals: [],
        score: 30,
        coveredServiceIds: ['service-id', 'service-b'],
      },
    ]);

    const result = await service.generateForUser({
      userId,
      persist: false,
    });

    expect(result).toEqual([]);
  });

  it('does not prune a stale generated recommendation linked to an order', async () => {
    const { service, recommendationRepository, relevanceRanker } =
      createService();
    const orderedRecommendation = {
      id: 'ordered-generated-recommendation-id',
      serviceId: 'service-id',
      packageId: null,
      status: RecommendationStatus.Recommended,
      source: RecommendationSource.AI,
      generatedAt: new Date('2026-01-01T00:00:00.000Z'),
      orderId: 'order-id',
    };
    recommendationRepository.find
      .mockResolvedValueOnce([orderedRecommendation])
      .mockResolvedValueOnce([orderedRecommendation]);
    relevanceRanker.rankRecommendations.mockReturnValue([
      {
        serviceId: null,
        packageId: 'package-id',
        serviceName: 'CRM package',
        priority: 'medium',
        rationale: 'package fit',
        diagnosticSignals: [],
        score: 30,
        coveredServiceIds: ['service-id', 'service-b'],
      },
    ]);

    const result = await service.generateForUser({
      userId,
      persist: true,
    });

    expect(result).toEqual([]);
    expect(recommendationRepository.delete).not.toHaveBeenCalled();
  });

  it.each([
    RecommendationStatus.Planned,
    RecommendationStatus.InProgress,
    RecommendationStatus.Completed,
  ])(
    'keeps %s recommendations from being replaced by overlapping packages',
    async (status) => {
      const { service, recommendationRepository, relevanceRanker } =
        createService();
      recommendationRepository.find.mockResolvedValue([
        {
          id: 'protected-service-recommendation-id',
          serviceId: 'service-id',
          packageId: null,
          status,
          generatedAt: new Date('2026-01-01T00:00:00.000Z'),
        },
      ]);
      relevanceRanker.rankRecommendations.mockReturnValue([
        {
          serviceId: null,
          packageId: 'package-id',
          serviceName: 'CRM package',
          priority: 'medium',
          rationale: 'package fit',
          diagnosticSignals: [],
          score: 30,
          coveredServiceIds: ['service-id', 'service-b'],
        },
      ]);

      const result = await service.generateForUser({
        userId,
        persist: false,
      });

      expect(result).toEqual([]);
    },
  );

  it.each([
    RecommendationStatus.Planned,
    RecommendationStatus.InProgress,
    RecommendationStatus.Completed,
  ])(
    'filters the exact %s recommendation target out of new generation',
    async (status) => {
      const { service, recommendationRepository, relevanceRanker } =
        createService();
      recommendationRepository.find.mockResolvedValue([
        {
          id: 'active-recommendation-id',
          serviceId: 'service-id',
          packageId: null,
          status,
          generatedAt: null,
          orderId: null,
        },
      ]);
      relevanceRanker.rankRecommendations.mockReturnValue([
        {
          serviceId: 'service-id',
          packageId: null,
          serviceName: 'Already active service',
          priority: 'urgent',
          rationale: 'fit',
          diagnosticSignals: [],
          score: 100,
          coveredServiceIds: ['service-id'],
        },
      ]);

      const result = await service.generateForUser({
        userId,
        persist: false,
      });

      expect(result).toEqual([]);
    },
  );

  it('filters an exact recommendation target linked to an order out of new generation', async () => {
    const { service, recommendationRepository, relevanceRanker } =
      createService();
    recommendationRepository.find.mockResolvedValue([
      {
        id: 'ordered-recommendation-id',
        serviceId: 'service-id',
        packageId: null,
        status: RecommendationStatus.Recommended,
        generatedAt: null,
        orderId: 'order-id',
      },
    ]);
    relevanceRanker.rankRecommendations.mockReturnValue([
      {
        serviceId: 'service-id',
        packageId: null,
        serviceName: 'Purchased service',
        priority: 'urgent',
        rationale: 'fit',
        diagnosticSignals: [],
        score: 100,
        coveredServiceIds: ['service-id'],
      },
    ]);

    const result = await service.generateForUser({
      userId,
      persist: false,
    });

    expect(result).toEqual([]);
  });

  it('keeps the more complete package when generated packages overlap', async () => {
    const { service, relevanceRanker } = createService();
    relevanceRanker.rankRecommendations.mockReturnValue([
      {
        serviceId: null,
        packageId: 'small-package-id',
        serviceName: 'Small CRM package',
        priority: 'urgent',
        rationale: 'small package fit',
        diagnosticSignals: [],
        score: 30,
        coveredServiceIds: ['service-a'],
      },
      {
        serviceId: null,
        packageId: 'full-package-id',
        serviceName: 'Full CRM package',
        priority: 'medium',
        rationale: 'full package fit',
        diagnosticSignals: [],
        score: 25,
        coveredServiceIds: ['service-a', 'service-b'],
      },
    ]);

    const result = await service.generateForUser({
      userId,
      persist: false,
    });

    expect(result.map((item) => item.packageId ?? item.serviceId)).toEqual([
      'full-package-id',
    ]);
  });

  it('compacts persisted packages by logical coverage, even when service UUIDs differ', async () => {
    const { service, recommendationRepository } = createService();
    const staleChild = {
      id: 'stale-office-recommendation-id',
      serviceId: null,
      packageId: 'office-package-id',
      status: RecommendationStatus.Recommended,
      source: RecommendationSource.AI,
      orderId: null,
      diagnosticSignals: [],
      package: {
        services: [
          {
            id: 'legacy-profile-id',
            name: 'Профиль вакансии',
            deletedAt: null,
            isHidden: false,
            skills: [],
          },
        ],
      },
    };
    const completePackage = {
      id: 'full-package-recommendation-id',
      serviceId: null,
      packageId: 'full-package-id',
      status: RecommendationStatus.Recommended,
      source: RecommendationSource.AI,
      orderId: null,
      diagnosticSignals: [],
      package: {
        services: [
          {
            id: 'canonical-profile-id',
            name: 'Профиль вакансии',
            deletedAt: null,
            isHidden: false,
            skills: [],
          },
          {
            id: 'canonical-dashboard-id',
            name: 'Дашборд ОП',
            deletedAt: null,
            isHidden: false,
            skills: [],
          },
        ],
      },
    };
    recommendationRepository.find.mockResolvedValue([
      staleChild,
      completePackage,
    ]);

    const deleted = await callPrivate<Promise<Set<string>>>(
      service,
      'compactReplaceableRecommendationSnapshot',
      userId,
    );

    expect(deleted).toEqual(new Set(['stale-office-recommendation-id']));
    expect(recommendationRepository.delete).toHaveBeenCalledWith([
      'stale-office-recommendation-id',
    ]);
  });

  it('keeps standalone relevant services when a package recommendation is compacted', async () => {
    const { service, recommendationRepository } = createService();
    recommendationRepository.find.mockResolvedValue([
      {
        id: 'stale-office-recommendation-id',
        serviceId: null,
        packageId: 'office-package-id',
        status: RecommendationStatus.Recommended,
        source: RecommendationSource.AI,
        orderId: null,
        diagnosticSignals: [],
        package: {
          services: [
            {
              id: 'legacy-profile-id',
              name: 'Профиль вакансии',
              deletedAt: null,
              isHidden: false,
              skills: [],
            },
          ],
        },
      },
      {
        id: 'full-package-recommendation-id',
        serviceId: null,
        packageId: 'full-package-id',
        status: RecommendationStatus.Recommended,
        source: RecommendationSource.AI,
        orderId: null,
        diagnosticSignals: [],
        package: {
          services: [
            {
              id: 'canonical-profile-id',
              name: 'Профиль вакансии',
              deletedAt: null,
              isHidden: false,
              skills: [],
            },
          ],
        },
      },
      {
        id: 'standalone-service-recommendation-id',
        serviceId: 'standalone-service-id',
        packageId: null,
        status: RecommendationStatus.Recommended,
        source: RecommendationSource.AI,
        orderId: null,
        diagnosticSignals: [],
        service: {
          id: 'standalone-service-id',
          name: 'Аудит CRM',
          deletedAt: null,
          isHidden: false,
          skills: [],
        },
      },
    ]);

    const deleted = await callPrivate<Promise<Set<string>>>(
      service,
      'compactReplaceableRecommendationSnapshot',
      userId,
    );

    expect(deleted).toEqual(new Set(['stale-office-recommendation-id']));
    expect(recommendationRepository.delete).toHaveBeenCalledWith([
      'stale-office-recommendation-id',
    ]);
  });

  it('does not compact a manual package recommendation', async () => {
    const { service, recommendationRepository } = createService();
    recommendationRepository.find.mockResolvedValue([
      {
        id: 'manual-office-recommendation-id',
        serviceId: null,
        packageId: 'office-package-id',
        status: RecommendationStatus.Recommended,
        source: RecommendationSource.Manual,
        orderId: null,
        diagnosticSignals: [],
        package: {
          services: [
            {
              id: 'legacy-profile-id',
              name: 'Профиль вакансии',
              deletedAt: null,
              isHidden: false,
              skills: [],
            },
          ],
        },
      },
      {
        id: 'generated-full-package-recommendation-id',
        serviceId: null,
        packageId: 'full-package-id',
        status: RecommendationStatus.Recommended,
        source: RecommendationSource.AI,
        orderId: null,
        diagnosticSignals: [],
        package: {
          services: [
            {
              id: 'canonical-profile-id',
              name: 'Профиль вакансии',
              deletedAt: null,
              isHidden: false,
              skills: [],
            },
          ],
        },
      },
      {
        id: 'unrelated-ai-service-recommendation-id',
        serviceId: 'unrelated-ai-service-id',
        packageId: null,
        status: RecommendationStatus.Recommended,
        source: RecommendationSource.AI,
        orderId: null,
        diagnosticSignals: [],
        service: {
          id: 'unrelated-ai-service-id',
          name: 'Аудит CRM',
          deletedAt: null,
          isHidden: false,
          skills: [],
        },
      },
    ]);

    const deleted = await callPrivate<Promise<Set<string>>>(
      service,
      'compactReplaceableRecommendationSnapshot',
      userId,
    );

    expect(deleted).toEqual(new Set());
    expect(recommendationRepository.delete).not.toHaveBeenCalled();
  });

  it('does not treat different interview services as covered by a shared semantic key', async () => {
    const { service, serviceRepository, recommendationRepository } =
      createService();
    serviceRepository.findOne = jest.fn().mockResolvedValue({
      id: 'phone-interview-service-id',
      name: 'Телефонное интервью',
      description: null,
      category: null,
      skills: [],
      deletedAt: null,
      isHidden: false,
    });
    recommendationRepository.find.mockResolvedValue([
      {
        id: 'candidate-interview-package-recommendation-id',
        serviceId: null,
        packageId: 'candidate-interview-package-id',
        status: RecommendationStatus.Recommended,
        package: {
          id: 'candidate-interview-package-id',
          deletedAt: null,
          isHidden: false,
          services: [
            {
              id: 'video-interview-service-id',
              name: 'Видео-интервью',
              description: null,
              category: null,
              skills: [],
              deletedAt: null,
              isHidden: false,
            },
          ],
        },
      },
    ]);

    const covered = await callPrivate<Promise<boolean>>(
      service,
      'isServiceCoveredByRecommendedPackage',
      userId,
      'phone-interview-service-id',
    );

    expect(covered).toBe(false);
  });

  it('does not prune an AI service for a package with only shared semantic coverage', async () => {
    const { service, packageRepository, recommendationRepository } =
      createService();
    packageRepository.findOne.mockResolvedValue({
      id: 'candidate-interview-package-id',
      deletedAt: null,
      isHidden: false,
      services: [
        {
          id: 'video-interview-service-id',
          name: 'Видео-интервью',
          description: null,
          category: null,
          skills: [],
          deletedAt: null,
          isHidden: false,
        },
      ],
    });
    recommendationRepository.find.mockResolvedValue([
      {
        id: 'phone-interview-recommendation-id',
        serviceId: 'phone-interview-service-id',
        packageId: null,
        status: RecommendationStatus.Recommended,
        source: RecommendationSource.AI,
        orderId: null,
        diagnosticSignals: [],
        service: {
          id: 'phone-interview-service-id',
          name: 'Телефонное интервью',
          description: null,
          category: null,
          skills: [],
          deletedAt: null,
          isHidden: false,
        },
      },
    ]);

    await callPrivate<Promise<void>>(
      service,
      'pruneReplaceableRecommendationsCoveredByPackage',
      userId,
      'candidate-interview-package-id',
    );

    expect(recommendationRepository.delete).not.toHaveBeenCalled();
  });

  it('prunes standalone turnkey hiring covered by two-manager hiring', async () => {
    const { service, packageRepository, recommendationRepository } =
      createService();
    packageRepository.findOne.mockResolvedValue({
      id: 'from-zero-package-id',
      deletedAt: null,
      isHidden: false,
      services: [
        {
          id: 'two-manager-hiring-service-id',
          name: twoManagerTurnkeyHiringName,
          description: 'Full-cycle hiring of two sales managers',
          category: null,
          skills: [],
          deletedAt: null,
          isHidden: false,
        },
      ],
    });
    recommendationRepository.find.mockResolvedValue([
      {
        id: 'turnkey-hiring-recommendation-id',
        serviceId: 'turnkey-hiring-service-id',
        packageId: null,
        status: RecommendationStatus.Recommended,
        source: RecommendationSource.AI,
        orderId: null,
        diagnosticSignals: [],
        service: {
          id: 'turnkey-hiring-service-id',
          name: '\u041f\u043e\u0434\u0431\u043e\u0440 \u043f\u043e\u0434 \u043a\u043b\u044e\u0447',
          description: 'Full-cycle hiring of one sales manager',
          category: null,
          skills: [],
          deletedAt: null,
          isHidden: false,
        },
      },
    ]);

    await callPrivate<Promise<void>>(
      service,
      'pruneReplaceableRecommendationsCoveredByPackage',
      userId,
      'from-zero-package-id',
    );

    expect(recommendationRepository.delete).toHaveBeenCalledWith([
      'turnkey-hiring-recommendation-id',
    ]);
  });

  it('prefers a relevant package over covered services even when they scored higher', async () => {
    const { service, relevanceRanker } = createService();
    relevanceRanker.rankRecommendations.mockReturnValue([
      {
        serviceId: 'crm-audit-id',
        packageId: null,
        serviceName: 'Аудит CRM',
        priority: RecommendationPriority.Urgent,
        rationale: 'crm audit',
        diagnosticSignals: [],
        score: 70,
        coveredServiceIds: ['crm-audit-id'],
      },
      {
        serviceId: null,
        packageId: 'crm-silver-package-id',
        serviceName: 'CRM Серебро',
        priority: RecommendationPriority.Medium,
        rationale: 'crm package',
        diagnosticSignals: [],
        score: 60,
        coveredServiceIds: ['crm-audit-id', 'dashboard-id', 'crm-report-id'],
      },
      {
        serviceId: 'dashboard-id',
        packageId: null,
        serviceName: 'Дашборд ОП',
        priority: RecommendationPriority.Medium,
        rationale: 'analytics',
        diagnosticSignals: [],
        score: 60,
        coveredServiceIds: ['dashboard-id'],
      },
    ]);

    const result = await service.generateForUser({
      userId,
      persist: false,
    });

    expect(result.map((item) => item.packageId ?? item.serviceId)).toEqual([
      'crm-silver-package-id',
    ]);
  });

  it('does not let a weak package replace a much stronger covered service', async () => {
    const { service, relevanceRanker } = createService();
    relevanceRanker.rankRecommendations.mockReturnValue([
      {
        serviceId: 'crm-audit-id',
        packageId: null,
        serviceName: 'Аудит CRM',
        priority: RecommendationPriority.Urgent,
        rationale: 'high confidence audit',
        diagnosticSignals: [],
        score: 120,
        coveredServiceIds: ['crm-audit-id'],
      },
      {
        serviceId: null,
        packageId: 'crm-silver-package-id',
        serviceName: 'CRM Серебро',
        priority: RecommendationPriority.Medium,
        rationale: 'weak crm package',
        diagnosticSignals: [],
        score: 60,
        coveredServiceIds: ['crm-audit-id', 'crm-report-id'],
      },
    ]);

    const result = await service.generateForUser({
      userId,
      persist: false,
    });

    expect(result.map((item) => item.packageId ?? item.serviceId)).toEqual([
      'crm-audit-id',
    ]);
  });

  it('does not let a package replace an ideal-reference covered service', async () => {
    const { service, relevanceRanker } = createService();
    relevanceRanker.rankRecommendations.mockReturnValue([
      {
        serviceId: 'crm-audit-id',
        packageId: null,
        serviceName: 'Аудит CRM',
        priority: RecommendationPriority.Urgent,
        rationale: 'golden recommendation',
        diagnosticSignals: ['ideal_reference:existing_department'],
        score: 60,
        coveredServiceIds: ['crm-audit-id'],
      },
      {
        serviceId: null,
        packageId: 'crm-silver-package-id',
        serviceName: 'CRM Серебро',
        priority: RecommendationPriority.Urgent,
        rationale: 'crm package',
        diagnosticSignals: [],
        score: 60,
        coveredServiceIds: ['crm-audit-id', 'crm-report-id'],
      },
    ]);

    const result = await service.generateForUser({
      userId,
      persist: false,
    });

    expect(result.map((item) => item.packageId ?? item.serviceId)).toEqual([
      'crm-audit-id',
    ]);
  });

  it('applies the requested limit only after package compaction', async () => {
    const { service, relevanceRanker } = createService();
    relevanceRanker.rankRecommendations.mockReturnValue([
      {
        serviceId: 'telephony-id',
        packageId: null,
        serviceName: 'Интеграция телефонии',
        priority: 'urgent',
        rationale: 'fit',
        diagnosticSignals: [],
        score: 100,
        coveredServiceIds: ['telephony-id'],
      },
      {
        serviceId: 'messenger-id',
        packageId: null,
        serviceName: 'Интеграция мессенджера',
        priority: 'urgent',
        rationale: 'fit',
        diagnosticSignals: [],
        score: 99,
        coveredServiceIds: ['messenger-id'],
      },
      {
        serviceId: null,
        packageId: 'crm-start-id',
        serviceName: 'CRM Старт',
        priority: 'medium',
        rationale: 'package fit',
        diagnosticSignals: [],
        score: 85,
        coveredServiceIds: ['telephony-id', 'messenger-id', 'mail-id'],
      },
    ]);

    const result = await service.generateForUser({
      userId,
      persist: false,
      limit: 1,
    });

    expect(relevanceRanker.rankRecommendations).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      undefined,
    );
    expect(result.map((item) => item.packageId ?? item.serviceId)).toEqual([
      'crm-start-id',
    ]);
  });

  it('keeps the selected new department foundation above later AI analysis', async () => {
    const { service, relevanceRanker } = createService();
    relevanceRanker.rankRecommendations.mockReturnValue([
      {
        serviceId: RECOMMENDATION_CATALOG.aiCrmAnalysis.id,
        packageId: null,
        serviceName: 'ИИ анализ CRM',
        priority: RecommendationPriority.Urgent,
        rationale: 'после настройки',
        diagnosticSignals: [],
        score: 160,
        coveredServiceIds: [RECOMMENDATION_CATALOG.aiCrmAnalysis.id],
      },
      {
        serviceId: RECOMMENDATION_CATALOG.salesHead.id,
        packageId: null,
        serviceName: 'Руководитель отдела продаж',
        priority: RecommendationPriority.Urgent,
        rationale: 'сопровождение запуска',
        diagnosticSignals: ['new_department_foundation'],
        score: 99,
        coveredServiceIds: [RECOMMENDATION_CATALOG.salesHead.id],
      },
      {
        serviceId: null,
        packageId: RECOMMENDATION_CATALOG.salesDepartmentFromZero.id,
        serviceName: 'Отдел Продаж с нуля',
        priority: RecommendationPriority.Urgent,
        rationale: 'основа нового отдела',
        diagnosticSignals: ['new_department_foundation'],
        score: 100,
        coveredServiceIds: [],
      },
    ]);

    const result = await service.generateForUser({
      userId,
      persist: false,
    });

    expect(result.map((item) => item.packageId ?? item.serviceId)).toEqual([
      RECOMMENDATION_CATALOG.salesDepartmentFromZero.id,
      RECOMMENDATION_CATALOG.salesHead.id,
      RECOMMENDATION_CATALOG.aiCrmAnalysis.id,
    ]);
  });

  it('keeps golden reference recommendations above expanded generated matches', async () => {
    const { service, relevanceRanker } = createService();
    relevanceRanker.rankRecommendations.mockReturnValue([
      {
        serviceId: 'golden-lower-score-id',
        packageId: null,
        serviceName: 'Golden recommendation',
        priority: RecommendationPriority.Urgent,
        rationale: 'golden',
        diagnosticSignals: [
          'ideal_reference:new_outbound_full_sales_department',
        ],
        score: 90,
      },
      {
        serviceId: 'expanded-higher-score-id',
        packageId: null,
        serviceName: 'Expanded generated recommendation',
        priority: RecommendationPriority.Urgent,
        rationale: 'expanded',
        diagnosticSignals: ['ai_generated'],
        score: 120,
      },
    ]);

    const result = await service.generateForUser({
      userId,
      persist: false,
    });

    expect(result.map((item) => item.serviceId)).toEqual([
      'golden-lower-score-id',
      'expanded-higher-score-id',
    ]);
  });

  it('persists generated packages with packageId instead of serviceId', async () => {
    const { service, recommendationRepository, relevanceRanker } =
      createService();
    recommendationRepository.findOne.mockResolvedValue(null);
    relevanceRanker.rankRecommendations.mockReturnValue([
      {
        serviceId: null,
        packageId: 'package-id',
        serviceName: 'CRM package',
        priority: 'urgent',
        rationale: 'package fit',
        diagnosticSignals: [],
        score: 30,
        coveredServiceIds: ['service-id'],
      },
    ]);

    await service.generateForUser({
      userId,
      persist: true,
    });

    expect(recommendationRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        serviceId: null,
        packageId: 'package-id',
      }),
    );
  });

  it('filters out generated recommendations below the strong relevance threshold before persisting', async () => {
    const { service, recommendationRepository, relevanceRanker } =
      createService();
    recommendationRepository.findOne.mockResolvedValue(null);
    relevanceRanker.rankRecommendations.mockReturnValue([
      {
        serviceId: 'low-score-service-id',
        packageId: null,
        serviceName: 'Low score service',
        priority: RecommendationPriority.Low,
        rationale: 'weak fit',
        diagnosticSignals: [],
        score: 19,
        coveredServiceIds: ['low-score-service-id'],
      },
      {
        serviceId: 'threshold-service-id',
        packageId: null,
        serviceName: 'Threshold service',
        priority: RecommendationPriority.Medium,
        rationale: 'minimum fit',
        diagnosticSignals: [],
        score: 20,
        coveredServiceIds: ['threshold-service-id'],
      },
    ]);

    const result = await service.generateForUser({
      userId,
      persist: true,
    });

    expect(result.map((item) => item.serviceId)).toEqual([
      'threshold-service-id',
    ]);
    expect(recommendationRepository.create).toHaveBeenCalledTimes(1);
    expect(recommendationRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        serviceId: 'threshold-service-id',
      }),
    );
  });

  it('prunes stale legacy questionnaire rows after persisting the current set', async () => {
    const { service, recommendationRepository, relevanceRanker } =
      createService();
    recommendationRepository.find
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: 'stale-service-recommendation-id',
          serviceId: 'stale-service-id',
          packageId: null,
          status: RecommendationStatus.Recommended,
          source: RecommendationSource.Manual,
          rationale:
            'Аудит CRM: рекомендация выбрана по анкете (старая анкета).',
          diagnosticSignals: [],
          generatedAt: null,
          orderId: null,
        },
        {
          id: 'current-package-recommendation-id',
          serviceId: null,
          packageId: 'package-id',
          status: RecommendationStatus.Recommended,
          generatedAt: new Date('2026-01-01T00:00:00.000Z'),
        },
      ]);
    recommendationRepository.find.mockResolvedValueOnce([
      {
        id: 'stale-service-recommendation-id',
        serviceId: 'stale-service-id',
        packageId: null,
        status: RecommendationStatus.Recommended,
        source: RecommendationSource.Manual,
        rationale: 'Аудит CRM: рекомендация выбрана по анкете (старая анкета).',
        diagnosticSignals: [],
        generatedAt: null,
        orderId: null,
      },
      {
        id: 'current-package-recommendation-id',
        serviceId: null,
        packageId: 'package-id',
        status: RecommendationStatus.Recommended,
        generatedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    ]);
    recommendationRepository.findOne.mockResolvedValue(null);
    relevanceRanker.rankRecommendations.mockReturnValue([
      {
        serviceId: null,
        packageId: 'package-id',
        serviceName: 'CRM package',
        priority: 'medium',
        rationale: 'package fit',
        diagnosticSignals: [],
        score: 30,
        coveredServiceIds: ['service-id'],
      },
    ]);

    await service.generateForUser({
      userId,
      persist: true,
    });

    expect(recommendationRepository.delete).toHaveBeenCalledWith([
      'stale-service-recommendation-id',
    ]);
  });
  it('lets a package replace stale generated child recommendations and prunes them', async () => {
    const { service, recommendationRepository, relevanceRanker } =
      createService();
    const staleGeneratedChildren = [
      {
        id: 'stale-telephony-recommendation-id',
        serviceId: 'telephony-id',
        packageId: null,
        status: RecommendationStatus.Recommended,
        source: RecommendationSource.AI,
        generatedAt: new Date('2026-01-01T00:00:00.000Z'),
        orderId: null,
      },
      {
        id: 'stale-messenger-recommendation-id',
        serviceId: 'messenger-id',
        packageId: null,
        status: RecommendationStatus.Recommended,
        source: RecommendationSource.AI,
        generatedAt: new Date('2026-01-01T00:00:00.000Z'),
        orderId: null,
      },
    ];
    recommendationRepository.find
      .mockResolvedValueOnce(staleGeneratedChildren)
      .mockResolvedValueOnce(staleGeneratedChildren)
      .mockResolvedValueOnce(staleGeneratedChildren);
    recommendationRepository.findOne.mockResolvedValue(null);
    relevanceRanker.rankRecommendations.mockReturnValue([
      {
        serviceId: 'telephony-id',
        packageId: null,
        serviceName: 'Telephony',
        priority: 'urgent',
        rationale: 'fit',
        diagnosticSignals: [],
        score: 90,
        coveredServiceIds: ['telephony-id'],
      },
      {
        serviceId: 'messenger-id',
        packageId: null,
        serviceName: 'Messenger',
        priority: 'urgent',
        rationale: 'fit',
        diagnosticSignals: [],
        score: 89,
        coveredServiceIds: ['messenger-id'],
      },
      {
        serviceId: null,
        packageId: 'data-driven-package-id',
        serviceName: 'Any package',
        priority: 'medium',
        rationale: 'package fit',
        diagnosticSignals: [],
        score: 80,
        coveredServiceIds: ['telephony-id', 'messenger-id', 'mail-id'],
      },
    ]);

    const result = await service.generateForUser({
      userId,
      persist: true,
    });

    expect(result.map((item) => item.packageId ?? item.serviceId)).toEqual([
      'data-driven-package-id',
    ]);
    expect(recommendationRepository.delete).toHaveBeenCalledWith([
      'stale-telephony-recommendation-id',
      'stale-messenger-recommendation-id',
    ]);
  });

  it('keeps a persisted ideal reference from being replaced by a package', async () => {
    const { service, recommendationRepository, relevanceRanker } =
      createService();
    recommendationRepository.find.mockResolvedValue([
      {
        id: 'ideal-service-recommendation-id',
        serviceId: 'service-id',
        packageId: null,
        status: RecommendationStatus.Recommended,
        source: RecommendationSource.AI,
        diagnosticSignals: ['ideal_reference:existing_department'],
        generatedAt: new Date('2026-01-01T00:00:00.000Z'),
        orderId: null,
      },
    ]);
    relevanceRanker.rankRecommendations.mockReturnValue([
      {
        serviceId: null,
        packageId: 'package-id',
        serviceName: 'CRM package',
        priority: 'medium',
        rationale: 'package fit',
        diagnosticSignals: [],
        score: 80,
        coveredServiceIds: ['service-id', 'service-b'],
      },
    ]);

    const result = await service.generateForUser({
      userId,
      persist: false,
    });

    expect(result).toEqual([]);
  });

  it('includes active package services even when they fall outside the scanned service limit', async () => {
    const { service, serviceRepository, packageRepository } = createService();
    const scanQuery = createQueryBuilder();
    scanQuery.getMany.mockResolvedValue([
      {
        id: 'recent-service-id',
        name: 'Recent service',
        description: 'Recent service description',
        type: ServiceType.Service,
        isHidden: false,
        deletedAt: null,
        skills: [],
        category: null,
        createdAt: new Date('2026-07-01T00:00:00.000Z'),
      },
    ]);
    serviceRepository.createQueryBuilder.mockReturnValue(scanQuery);
    packageRepository.find.mockResolvedValue([
      {
        id: 'package-id',
        name: 'Package',
        description: 'Package description',
        packageType: null,
        tags: [],
        categories: [],
        category: null,
        categoryId: null,
        price: 0,
        isHidden: false,
        deletedAt: null,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        services: [
          {
            id: 'old-package-service-id',
            name: 'Old package service',
            description: 'Package child description',
            type: ServiceType.Service,
            isHidden: false,
            deletedAt: null,
            skills: [],
            category: null,
            createdAt: new Date('2020-01-01T00:00:00.000Z'),
          },
        ],
      },
    ]);

    const candidates = (await callPrivate(
      service,
      'findRecommendableServices',
    )) as Array<{ serviceId?: string | null }>;

    expect(scanQuery.take).toHaveBeenCalledWith(500);
    expect(candidates.map((candidate) => candidate.serviceId)).toContain(
      'old-package-service-id',
    );
  });
});
