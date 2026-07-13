import { QuestionnairesService } from './questionnaires.service';

describe('QuestionnairesService', () => {
  const userId = 'user-id';
  const answers = {
    name: 'Ivan',
    phone: '+79001234567',
    companyName: 'AltaSales',
    industry: 'CRM',
    productStage: 'existing',
    targetRevenue: 10000000,
    components: { crm: true },
  };

  const createService = (
    existingQuestionnaire: Record<string, unknown> | null = null,
  ) => {
    const savedQuestionnaire = {
      id: existingQuestionnaire?.id ?? 'questionnaire-id',
      userId,
      answers,
    };
    const repo = {
      findOne: jest.fn().mockResolvedValue(existingQuestionnaire),
      create: jest.fn().mockReturnValue(savedQuestionnaire),
      save: jest.fn((value) => Promise.resolve(value)),
    };
    const recommendationsService = {
      startGenerationForUser: jest.fn().mockResolvedValue({ id: 'job-id' }),
      findAssignedToUserList: jest.fn(),
    };
    const usersService = {
      findOne: jest
        .fn()
        .mockResolvedValue({ id: userId, email: 'user@test.dev' }),
    };
    const mailService = {
      notifyAdminsAboutNewQuestionnaire: jest.fn().mockResolvedValue(undefined),
    };
    const balanceService = {
      hasRegistrationGift: jest.fn().mockResolvedValue(false),
      creditRegistrationGift: jest.fn().mockResolvedValue(undefined),
      getBalance: jest.fn().mockResolvedValue({ total: 10000 }),
    };
    const websocketGateway = {
      emitToUser: jest.fn(),
    };

    const ropProvisioningService = {
      scheduleProjectCreation: jest.fn(),
    };
    const service = new QuestionnairesService(
      repo as any,
      recommendationsService as any,
      usersService as any,
      mailService as any,
      balanceService as any,
      websocketGateway as any,
      ropProvisioningService as any,
    );

    return {
      service,
      repo,
      recommendationsService,
      balanceService,
    };
  };

  it('starts recommendation generation after a new questionnaire is saved', async () => {
    const { service, recommendationsService } = createService();

    await service.create(answers as any, userId);

    expect(recommendationsService.startGenerationForUser).toHaveBeenCalledWith(
      userId,
      {
        clientProfile: answers,
        persist: true,
      },
    );
  });

  it('starts recommendation generation after an existing questionnaire is updated', async () => {
    const existing = {
      id: 'existing-questionnaire-id',
      userId,
      answers: { companyName: 'Old' },
    };
    const { service, recommendationsService, balanceService } =
      createService(existing);

    await service.create(answers as any, userId);

    expect(recommendationsService.startGenerationForUser).toHaveBeenCalledWith(
      userId,
      {
        clientProfile: answers,
        persist: true,
      },
    );
    expect(balanceService.hasRegistrationGift).not.toHaveBeenCalled();
  });

  it('starts recommendation generation after admin updates questionnaire answers', async () => {
    const existing = {
      id: 'existing-questionnaire-id',
      userId,
      answers: {
        ...answers,
        components: { crm: false },
      },
    };
    const { service, recommendationsService } = createService(existing);

    await service.updateAnswersForAdmin('existing-questionnaire-id', {
      components: { crm: true },
    } as any);

    expect(recommendationsService.startGenerationForUser).toHaveBeenCalledWith(
      userId,
      {
        clientProfile: {
          ...answers,
          components: { crm: true },
        },
        persist: true,
      },
    );
  });
});
