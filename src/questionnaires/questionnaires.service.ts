import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { REGISTRATION_GIFT_RUB } from '../balance-transactions/balance.constants';
import { BalanceService } from '../balance-transactions/balance.service';
import {
  RecommendationsService,
  type UserRecommendationListItem,
} from '../recommendations/recommendations.service';
import { WebSocketGatewayService } from '../websocket/websocket.gateway';
import { CreateQuestionnaireDto } from './dto/create-questionnaire.dto';
import { UpdateQuestionnaireAnswersDto } from './dto/update-questionnaire-answers.dto';
import { Questionnaire, type QuestionnaireAnswers } from './entities/questionnaire.entity';
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
    private readonly balanceService: BalanceService,
    private readonly websocketGateway: WebSocketGatewayService,
  ) { }

  async create(dto: CreateQuestionnaireDto, userId: string): Promise<Questionnaire> {
    const existing = await this.findByUserId(userId);

    if (existing) {
      existing.answers = this.dtoToAnswers(dto);
      return this.repo.save(existing);
    }

    const questionnaire = this.repo.create({
      userId,
      answers: this.dtoToAnswers(dto),
    });
    const saved = await this.repo.save(questionnaire);

    try {
      const alreadyCredited = await this.balanceService.hasRegistrationGift(userId);
      if (!alreadyCredited) {
        await this.balanceService.creditRegistrationGift(userId);

        const balance = await this.balanceService.getBalance(userId);
        this.websocketGateway.emitToUser(userId, 'balance:gift_credited', {
          amount: REGISTRATION_GIFT_RUB,
          balance,
        });
        this.logger.log(`Questionnaire gift credited for user ${userId}`);
      }
    } catch (error) {
      this.logger.error(
        `Failed to credit questionnaire gift for user ${userId}: ${error.message}`,
      );
    }

    this.notifyAdmins(saved, userId).catch((error) => {
      this.logger.error(`Failed to notify admins: ${error.message}`);
    });

    return saved;
  }

  private dtoToAnswers(dto: CreateQuestionnaireDto): QuestionnaireAnswers {
    return dto;
  }

  private isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  private mergeAnswers(
    current: Record<string, unknown>,
    patch: Record<string, unknown>,
  ): Record<string, unknown> {
    const result: Record<string, unknown> = { ...current };

    Object.entries(patch).forEach(([key, patchValue]) => {
      const currentValue = result[key];
      if (this.isPlainObject(currentValue) && this.isPlainObject(patchValue)) {
        result[key] = this.mergeAnswers(currentValue, patchValue);
        return;
      }
      result[key] = patchValue;
    });

    return result;
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
    return this.repo.findOne({ where: { userId } });
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

  async updateAnswersForAdmin(
    id: string,
    dto: UpdateQuestionnaireAnswersDto,
  ): Promise<Questionnaire> {
    const questionnaire = await this.repo.findOne({ where: { id } });
    if (!questionnaire) {
      throw new NotFoundException(`Questionnaire with id ${id} not found`);
    }

    questionnaire.answers = this.mergeAnswers(
      questionnaire.answers as unknown as Record<string, unknown>,
      dto as unknown as Record<string, unknown>,
    ) as unknown as Questionnaire['answers'];

    return this.repo.save(questionnaire);
  }
}
