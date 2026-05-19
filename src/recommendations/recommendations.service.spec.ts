import { BadRequestException } from '@nestjs/common';
import { RecommendationsService } from './recommendations.service';

describe('RecommendationsService dependency graph', () => {
  const userRepository = {
    findOne: jest.fn(),
  };
  const serviceRepository = {
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
    service = new RecommendationsService(
      recommendationRepository as never,
      userRepository as never,
      serviceRepository as never,
      orderRepository as never,
    );
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
});
