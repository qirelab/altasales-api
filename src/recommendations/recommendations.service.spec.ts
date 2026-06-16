import { RecommendationGenerationStatus } from './entities/recommendation-generation-status.enum';
import { RecommendationPriority } from './entities/recommendation-priority.enum';
import { RecommendationStatus } from './entities/recommendation-status.enum';
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
    ]);
    packageRepository.find.mockResolvedValue([
      {
        id: 'crm-silver-package-id',
        name: 'CRM Серебро',
        description: 'Расширенная настройка CRM',
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
      expect.arrayContaining(['inner-tz-service-id', 'tech-spec-service-id']),
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
        score: 10,
        coveredServiceIds: ['service-id'],
      },
      {
        serviceId: 'service-id',
        packageId: null,
        serviceName: 'CRM setup',
        priority: 'medium',
        rationale: 'service fit',
        diagnosticSignals: [],
        score: 8,
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
        score: 10,
        coveredServiceIds: ['catalog_semantic:crm_technical_spec'],
      },
      {
        serviceId: 'tech-spec-service-id',
        packageId: null,
        serviceName: 'Подготовка технического задания',
        priority: 'medium',
        rationale: 'service fit',
        diagnosticSignals: [],
        score: 8,
        coveredServiceIds: [
          'tech-spec-service-id',
          'catalog_semantic:crm_technical_spec',
        ],
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

  it('keeps the same existing package but skips separate services already covered by it', async () => {
    const { service, recommendationRepository, relevanceRanker } =
      createService();
    recommendationRepository.find.mockResolvedValue([
      {
        serviceId: null,
        packageId: 'package-id',
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
        score: 10,
        coveredServiceIds: ['service-id'],
      },
      {
        serviceId: null,
        packageId: 'package-id',
        serviceName: 'CRM package',
        priority: 'medium',
        rationale: 'package fit',
        diagnosticSignals: [],
        score: 8,
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
        score: 10,
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

  it('keeps protected existing recommendations from being replaced by overlapping packages', async () => {
    const { service, recommendationRepository, relevanceRanker } =
      createService();
    recommendationRepository.find.mockResolvedValue([
      {
        id: 'planned-service-recommendation-id',
        serviceId: 'service-id',
        packageId: null,
        status: RecommendationStatus.Planned,
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
        score: 10,
        coveredServiceIds: ['service-id', 'service-b'],
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
        score: 10,
        coveredServiceIds: ['service-a'],
      },
      {
        serviceId: null,
        packageId: 'full-package-id',
        serviceName: 'Full CRM package',
        priority: 'medium',
        rationale: 'full package fit',
        diagnosticSignals: [],
        score: 8,
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
        score: 10,
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

  it('filters out generated recommendations with ranking below 5/10 before persisting', async () => {
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
        score: 4,
        coveredServiceIds: ['low-score-service-id'],
      },
      {
        serviceId: 'threshold-service-id',
        packageId: null,
        serviceName: 'Threshold service',
        priority: RecommendationPriority.Medium,
        rationale: 'minimum fit',
        diagnosticSignals: [],
        score: 5,
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
        score: 10,
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
});
