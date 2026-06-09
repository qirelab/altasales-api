import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, Repository } from 'typeorm';
import { MailService } from '../mail/mail.service';
import { CreateFeedbackDto } from './dto/create-feedback.dto';
import { FeedbackAdminQueryDto } from './dto/feedback-query.dto';
import { UpdateFeedbackStatusDto } from './dto/update-feedback.dto';
import { Feedback } from './entities/feedback.entity';
import { FeedbackStatus } from './entities/feedback-status.enum';

export interface FeedbackListItemDto {
  id: string;
  message: string;
  rating: number | null;
  status: FeedbackStatus;
  createdAt: Date;
  updatedAt: Date;
  user: {
    id: string;
    name: string;
    lastName: string;
    email: string;
  };
}

export interface FeedbackListResponse {
  data: FeedbackListItemDto[];
  total: number;
  page: number;
  pageSize: number;
}

const SUBMIT_COOLDOWN_MS = 60_000;

@Injectable()
export class FeedbackService {
  private readonly logger = new Logger(FeedbackService.name);
  private readonly lastSubmitByUser = new Map<string, number>();

  constructor(
    @InjectRepository(Feedback)
    private readonly feedbackRepository: Repository<Feedback>,
    private readonly mailService: MailService,
  ) {}

  async createForUser(userId: string, dto: CreateFeedbackDto): Promise<Feedback> {
    const now = Date.now();
    const last = this.lastSubmitByUser.get(userId);
    if (last && now - last < SUBMIT_COOLDOWN_MS) {
      const wait = Math.ceil((SUBMIT_COOLDOWN_MS - (now - last)) / 1000);
      throw new BadRequestException(
        `Можно отправлять обратную связь не чаще раза в минуту. Подождите ${wait} с.`,
      );
    }

    const feedback = this.feedbackRepository.create({
      userId,
      message: dto.message.trim(),
      rating: dto.rating ?? null,
    });
    const saved = await this.feedbackRepository.save(feedback);
    this.lastSubmitByUser.set(userId, now);

    this.mailService
      .sendNewFeedbackNotification(saved)
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(`Failed to send feedback notification email: ${message}`);
      });

    return saved;
  }

  async findAdminList(query: FeedbackAdminQueryDto): Promise<FeedbackListResponse> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const sortBy = query.sortBy ?? 'createdAt';
    const sortDir = (query.sortDir ?? 'desc').toUpperCase() as 'ASC' | 'DESC';

    const qb = this.feedbackRepository
      .createQueryBuilder('feedback')
      .leftJoinAndSelect('feedback.user', 'user');

    if (query.status) {
      qb.andWhere('feedback.status = :status', { status: query.status });
    }

    if (query.search?.trim()) {
      const search = `%${query.search.trim()}%`;
      qb.andWhere(new Brackets((sub) => {
        sub
          .where('feedback.message ILIKE :search', { search })
          .orWhere('user.name ILIKE :search', { search })
          .orWhere('user."lastName" ILIKE :search', { search })
          .orWhere('user.email ILIKE :search', { search })
          .orWhere(`CONCAT(user.name, ' ', user."lastName") ILIKE :search`, { search });
      }));
    }

    const sortColumnMap: Record<string, string> = {
      createdAt: 'feedback.createdAt',
      rating: 'feedback.rating',
      status: 'feedback.status',
    };
    const sortColumn = sortColumnMap[sortBy] ?? 'feedback.createdAt';
    qb.orderBy(sortColumn, sortDir);

    const total = await qb.getCount();
    const rows = await qb
      .skip((page - 1) * pageSize)
      .take(pageSize)
      .getMany();

    return {
      data: rows.map((row) => this.toDto(row)),
      total,
      page,
      pageSize,
    };
  }

  async updateStatus(id: string, dto: UpdateFeedbackStatusDto): Promise<Feedback> {
    const feedback = await this.feedbackRepository.findOne({ where: { id } });
    if (!feedback) {
      throw new NotFoundException(`Обращение ${id} не найдено`);
    }
    feedback.status = dto.status;
    return this.feedbackRepository.save(feedback);
  }

  private toDto(feedback: Feedback): FeedbackListItemDto {
    return {
      id: feedback.id,
      message: feedback.message,
      rating: feedback.rating,
      status: feedback.status,
      createdAt: feedback.createdAt,
      updatedAt: feedback.updatedAt,
      user: {
        id: feedback.user?.id ?? feedback.userId,
        name: feedback.user?.name ?? '',
        lastName: feedback.user?.lastName ?? '',
        email: feedback.user?.email ?? '',
      },
    };
  }
}
