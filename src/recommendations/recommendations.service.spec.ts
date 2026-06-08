import { RecommendationGenerationStatus } from './entities/recommendation-generation-status.enum';
import { RecommendationsService } from './recommendations.service';

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
    const questionnaireRepository = {
      findOne: jest.fn().mockResolvedValue({
        userId,
        answers: questionnaireAnswers,
      }),
    };
    const scoringService = {
      buildDiagnosticContext: jest.fn().mockReturnValue('context'),
      generateAiRecommendations: jest.fn().mockResolvedValue([]),
      scoreService: jest.fn(),
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

  it('keeps the same existing package but skips separate services already covered by it', async () => {
    const { service, recommendationRepository, relevanceRanker } = createService();
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
    const { service, recommendationRepository, relevanceRanker } = createService();
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
});
