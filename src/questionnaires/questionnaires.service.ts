import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Questionnaire } from './entities/questionnaire.entity';
import { CreateQuestionnaireDto } from './dto/create-questionnaire.dto';

@Injectable()
export class QuestionnairesService {
  constructor(
    @InjectRepository(Questionnaire)
    private readonly repo: Repository<Questionnaire>,
  ) {}

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
    return this.repo.findOne({ where: { userId }, order: { createdAt: 'DESC' } });
  }
}
