import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  RecommendationsService,
  type UserRecommendationListItem,
} from '../recommendations/recommendations.service';
import { CreateQuestionnaireDto } from './dto/create-questionnaire.dto';
import { Questionnaire } from './entities/questionnaire.entity';
import { UsersService } from '../users/users.service';
import { MailService } from '../mail/mail.service';

@Injectable()
export class QuestionnairesService {
  private readonly logger = new Logger(QuestionnairesService.name);

  constructor(
    @InjectRepository(Questionnaire)
    private readonly repo: Repository<Questionnaire>,
    private readonly recommendationsService: RecommendationsService,
    private readonly usersService: UsersService,
    private readonly mailService: MailService,
  ) { }

  async create(dto: CreateQuestionnaireDto, userId: string): Promise<Questionnaire> {
    const questionnaire = this.repo.create({
      userId,
      answers: dto,
    });
    const saved = await this.repo.save(questionnaire);

    this.notifyAdmins(saved, userId).catch((error) => {
      this.logger.error(`Failed to notify admins: ${error.message}`);
    });

    return saved;
  }

  private async notifyAdmins(
    questionnaire: Questionnaire,
    userId: string,
  ): Promise<void> {
    let user;
    try {
      user = await this.usersService.findOne(userId);
    } catch {
      return;
    }

    await this.mailService.notifyAdminsAboutNewQuestionnaire({
      userName: questionnaire.answers.name,
      userEmail: user.email,
      userPhone: questionnaire.answers.phone,
      companyName: questionnaire.answers.industry,
      questionnaireId: questionnaire.id,
      userId,
    });
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
