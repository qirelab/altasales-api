import { RecommendationGenerationStatus } from './entities/recommendation-generation-status.enum';
import { RecommendationPriority } from './entities/recommendation-priority.enum';
import { RecommendationSource } from './entities/recommendation-source.enum';
import { RecommendationStatus } from './entities/recommendation-status.enum';
import { RECOMMENDATION_CATALOG } from './recommendation-catalog.registry';
import { RecommendationsService } from './recommendations.service';
import { ServiceType } from '../services/entities/service-type.enum';

describe('RecommendationsService', () => {
  const userId = 'user-id';
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

    const service = new RecommendationsService(
      recommendationRepository as any,
      userRepository as any,
      serviceRepository as any,
      packageRepository as any,
      orderRepository as any,
      orderItemRepository as any,
      questionnaireRepository as any,
      scoringService as any,
      relevanceRanker as any,
      generationJobService as any,
      notificationService as any,
    );

    return {
      service,
      questionnaireRepository,
      recommendationRepository,
      serviceRepository,
      packageRepository,
      scoringService,
      relevanceRanker,
      generationJobService,
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
    expect(crmStart.coveredServiceIds).toEqual(
      expect.arrayContaining(crmStartServices.map((item) => item.id)),
    );
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
        coveredServiceIds: expect.arrayContaining([
          'recruitment-service-id',
          'crm-setup-service-id',
        ]),
      }),
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
    expect(packageCandidate.coveredServiceIds).toEqual(
      expect.arrayContaining(['inner-tz-service-id']),
    );
    expect(packageCandidate.coveredServiceIds).not.toEqual(
      expect.arrayContaining(['tech-spec-service-id', 'crm-audit-service-id']),
    );
    const documentsPackageCandidate = candidates.find(
      (item) => item.packageId === 'documents-package-id',
    );
    expect(documentsPackageCandidate.coveredServiceIds).toEqual(
      expect.arrayContaining(['instruction-service-id']),
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
        coveredServiceIds: ['service-a'],
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

    const deleted = await (service as any).compactReplaceableRecommendationSnapshot(
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

    const deleted = await (service as any).compactReplaceableRecommendationSnapshot(
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
    ]);

    const deleted = await (service as any).compactReplaceableRecommendationSnapshot(
      userId,
    );

    expect(deleted).toEqual(new Set());
    expect(recommendationRepository.delete).not.toHaveBeenCalled();
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

  it('prunes stale generated recommendations after persisting the current set', async () => {
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
          generatedAt: new Date('2026-01-01T00:00:00.000Z'),
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
});
