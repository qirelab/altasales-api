import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  RecommendationsService,
  type UserRecommendationListItem,
} from '../recommendations/recommendations.service';
import { CreateQuestionnaireDto } from './dto/create-questionnaire.dto';
import { Questionnaire } from './entities/questionnaire.entity';
import { UsersService } from '../users/users.service';

@Injectable()
export class QuestionnairesService {
  constructor(
    @InjectRepository(Questionnaire)
    private readonly repo: Repository<Questionnaire>,
    private readonly recommendationsService: RecommendationsService,
    private readonly usersService: UsersService,
  ) { }

  async create(dto: CreateQuestionnaireDto, userId: string): Promise<Questionnaire> {
    const questionnaire = this.repo.create({
      userId,
      answers: dto,
    });
    return this.repo.save(questionnaire);
  }

  async findAll(): Promise<Questionnaire[]> {
    return this.repo.find({ order: { createdAt: 'DESC' } });
  }

  async findOne(id: string): Promise<Questionnaire | null> {
    return this.repo.findOne({ where: { id } });
  }

  async findByUserId(userId: string): Promise<Questionnaire | null> {
    const questionnaire = await this.repo.findOne({ where: { userId }, order: { createdAt: 'DESC' } });
    return questionnaire ?? null;
  }

  async findByUserIdForAdmin(
    userId: string,
  ): Promise<{
    questionnaire: Questionnaire | null;
    recommendations: UserRecommendationListItem[];
  }> {
    const [questionnaire, recommendations] = await Promise.all([
      this.findByUserId(userId),
      this.recommendationsService.findAssignedToUserList(userId),
    ]);

    return {
      questionnaire,
      recommendations,
    };
  }
}
