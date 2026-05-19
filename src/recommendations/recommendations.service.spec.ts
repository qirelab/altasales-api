import { BadRequestException } from '@nestjs/common';
import { ServiceType } from '../services/entities/service-type.enum';
import { RecommendationPriority } from './entities/recommendation-priority.enum';
import { RecommendationsService } from './recommendations.service';

describe('RecommendationsService', () => {
  const userRepository = {
    findOne: jest.fn(),
  };
  const serviceRepository = {
    createQueryBuilder: jest.fn(),
    findOne: jest.fn(),
  };
  const recommendationRepository = {
    findOne: jest.fn(),
    find: jest.fn(),
    create: jest.fn((value) => value),
    save: jest.fn((value) => Promise.resolve(value)),
    delete: jest.fn(),
    createQueryBuilder: jest.fn(),
  };
  const orderRepository = {
    findOne: jest.fn(),
  };

  let service: RecommendationsService;

  beforeEach(() => {
    jest.clearAllMocks();
    userRepository.findOne.mockResolvedValue({ id: 'user-id' });
    service = new RecommendationsService(
      recommendationRepository as never,
      userRepository as never,
      serviceRepository as never,
      orderRepository as never,
    );
  });

  it('ranks generated recommendations by diagnostics and assigns urgency', async () => {
    serviceRepository.createQueryBuilder.mockReturnValue({
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([
        {
          id: 'crm-service-id',
          type: ServiceType.Service,
          name: 'CRM audit',
          description: 'Audit CRM data, statuses and funnel conversion',
          category: { name: 'CRM' },
          skills: [],
          contentSections: [],
        },
        {
          id: 'docs-service-id',
          type: ServiceType.Document,
          name: 'Sales documents',
          description: 'Prepare sales scripts and regulations',
          category: { name: 'Documents' },
          skills: [],
          contentSections: [],
        },
      ]),
    });

    const result = await service.generateForUser({
      userId: 'user-id',
      diagnostics: [
        'Revenue plan is at risk because CRM statuses and funnel conversion are broken',
      ],
      persist: false,
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      serviceId: 'crm-service-id',
      priority: RecommendationPriority.Urgent,
      diagnosticSignals: expect.arrayContaining([
        'funnel_conversion',
        'crm_quality',
      ]),
    });
  });

  it('rejects self dependency in recommendation graph', async () => {
    recommendationRepository.findOne.mockResolvedValue({
      id: 'rec-id',
      dependencyIds: [],
    });

    await expect(
      service.updateDependenciesForAdmin('rec-id', ['rec-id']),
    ).rejects.toThrow(
      new BadRequestException('Recommendation cannot depend on itself'),
    );
  });

  it('persists generated recommendations by upsert', async () => {
    serviceRepository.createQueryBuilder.mockReturnValue({
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([
        {
          id: 'crm-service-id',
          type: ServiceType.Service,
          name: 'CRM audit',
          description: 'CRM data and funnel conversion audit',
          category: { name: 'CRM' },
          skills: [],
          contentSections: [],
        },
      ]),
    });
    recommendationRepository.findOne.mockResolvedValue(null);

    const result = await service.generateForUser({
      userId: 'user-id',
      diagnostics: ['CRM funnel conversion is leaking revenue'],
    });

    expect(recommendationRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-id',
        serviceId: 'crm-service-id',
        priority: RecommendationPriority.Urgent,
      }),
    );
    expect(recommendationRepository.save).toHaveBeenCalledTimes(1);
    expect(result[0].recommendation).toBeDefined();
  });
});
