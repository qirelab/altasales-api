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
});
