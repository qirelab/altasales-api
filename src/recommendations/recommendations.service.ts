import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ServiceType } from '../services/entities/service-type.enum';
import { Recommendation } from './entities/recommendation.entity';

@Injectable()
export class RecommendationsService {
  constructor(
    @InjectRepository(Recommendation)
    private readonly recommendationRepository: Repository<Recommendation>,
  ) { }

  async findAssignedToUser(userId: string): Promise<Recommendation[]> {
    return this.recommendationRepository
      .createQueryBuilder('recommendation')
      .leftJoinAndSelect('recommendation.service', 'service')
      .leftJoinAndSelect('recommendation.order', 'order')
      .where('recommendation."userId" = :userId', { userId })
      .andWhere('service.type IN (:...serviceTypes)', {
        serviceTypes: [ServiceType.Service, ServiceType.Document],
      })
      .orderBy('recommendation."createdAt"', 'DESC')
      .getMany();
  }
}
