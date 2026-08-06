import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PiiAnonymizerService } from '../../../ai/pii-anonymizer.service';
import { KnowledgeDocument } from '../../../knowledge/entities/knowledge-document.entity';
import { CreateReferenceAnswerDto } from '../dto/create-reference-answer.dto';
import { ListReferenceAnswersDto, SortDir } from '../dto/list-reference-answers.dto';
import { UpdateReferenceAnswerDto } from '../dto/update-reference-answer.dto';
import { ChatbotReferenceAnswer } from '../entities/chatbot-reference-answer.entity';
import { ReferenceAnswerStatus } from '../enums/reference-answer-status.enum';
import { ReferenceAnswerPublisherService } from './reference-answer-publisher.service';

export type ListReferenceAnswersResult = {
  items: ChatbotReferenceAnswer[];
  total: number;
  page: number;
  pageSize: number;
};

const PII_ERROR_MESSAGE =
  'В тексте обнаружены персональные данные (email, телефон, ИНН, СНИЛС, паспорт, карта, дата рождения). '
  + 'Удалите или обезличьте их перед сохранением.';
const SOURCE_DOCUMENT_NOT_FOUND = 'Документ-источник не найден.';
const REFERENCE_ANSWER_NOT_FOUND = 'Эталонный ответ не найден.';

@Injectable()
export class ChatbotReferenceAnswersService {
  constructor(
    @InjectRepository(ChatbotReferenceAnswer)
    private readonly repository: Repository<ChatbotReferenceAnswer>,
    @InjectRepository(KnowledgeDocument)
    private readonly documentRepository: Repository<KnowledgeDocument>,
    private readonly piiAnonymizer: PiiAnonymizerService,
    private readonly publisher: ReferenceAnswerPublisherService,
  ) {}

  async create(
    dto: CreateReferenceAnswerDto,
    createdById: string | null,
  ): Promise<ChatbotReferenceAnswer> {
    this.assertNoPii(dto.question, dto.answer, dto.topic);
    if (dto.sourceDocumentId) {
      await this.assertSourceDocumentExists(dto.sourceDocumentId);
    }

    const entity = this.repository.create({
      question: dto.question,
      answer: dto.answer,
      topic: dto.topic,
      sourceDocumentId: dto.sourceDocumentId ?? null,
      createdById,
      status: ReferenceAnswerStatus.ACTIVE,
    });
    const saved = await this.repository.save(entity);
    const documentId = await this.publisher.publish(saved);
    if (documentId) {
      saved.publishedDocumentId = documentId;
      await this.repository.update(saved.id, { publishedDocumentId: documentId });
    }
    return saved;
  }

  async update(
    id: string,
    dto: UpdateReferenceAnswerDto,
  ): Promise<ChatbotReferenceAnswer> {
    const existing = await this.findOne(id);

    const nextQuestion = dto.question ?? existing.question;
    const nextAnswer = dto.answer ?? existing.answer;
    const nextTopic = dto.topic ?? existing.topic;

    if (dto.question !== undefined || dto.answer !== undefined || dto.topic !== undefined) {
      this.assertNoPii(nextQuestion, nextAnswer, nextTopic);
    }
    if (dto.sourceDocumentId) {
      await this.assertSourceDocumentExists(dto.sourceDocumentId);
    }

    existing.question = nextQuestion;
    existing.answer = nextAnswer;
    existing.topic = nextTopic;
    if (dto.sourceDocumentId !== undefined) {
      existing.sourceDocumentId = dto.sourceDocumentId;
    }

    const saved = await this.repository.save(existing);
    if (saved.status === ReferenceAnswerStatus.ACTIVE) {
      await this.republish(saved);
    }
    return saved;
  }

  private async republish(entity: ChatbotReferenceAnswer): Promise<void> {
    await this.publisher.unpublish(entity.publishedDocumentId);
    const documentId = await this.publisher.publish(entity);
    entity.publishedDocumentId = documentId;
    await this.repository.update(entity.id, { publishedDocumentId: documentId });
  }

  async findAll(query: ListReferenceAnswersDto): Promise<ListReferenceAnswersResult> {
    const qb = this.repository.createQueryBuilder('ref');

    if (query.status) {
      qb.andWhere('ref.status = :status', { status: query.status });
    }
    if (query.topic) {
      qb.andWhere('LOWER(ref.topic) = LOWER(:topic)', { topic: query.topic });
    }
    if (query.search) {
      const like = `%${query.search}%`;
      qb.andWhere(
        '(ref.question ILIKE :like OR ref.answer ILIKE :like OR ref.topic ILIKE :like)',
        { like },
      );
    }

    qb.orderBy(
      `ref.${query.sortBy}`,
      query.sortDir === SortDir.Asc ? 'ASC' : 'DESC',
    );
    qb.skip((query.page - 1) * query.pageSize);
    qb.take(query.pageSize);

    const [items, total] = await qb.getManyAndCount();
    return { items, total, page: query.page, pageSize: query.pageSize };
  }

  async findOne(id: string): Promise<ChatbotReferenceAnswer> {
    const entity = await this.repository.findOne({ where: { id } });
    if (!entity) {
      throw new NotFoundException(REFERENCE_ANSWER_NOT_FOUND);
    }
    return entity;
  }

  async archive(id: string): Promise<ChatbotReferenceAnswer> {
    return this.setStatus(id, ReferenceAnswerStatus.ARCHIVED);
  }

  async restore(id: string): Promise<ChatbotReferenceAnswer> {
    return this.setStatus(id, ReferenceAnswerStatus.ACTIVE);
  }

  private async setStatus(
    id: string,
    status: ReferenceAnswerStatus,
  ): Promise<ChatbotReferenceAnswer> {
    const existing = await this.findOne(id);
    if (existing.status === status) return existing;
    existing.status = status;
    const saved = await this.repository.save(existing);
    if (status === ReferenceAnswerStatus.ARCHIVED) {
      await this.publisher.unpublish(saved.publishedDocumentId);
      saved.publishedDocumentId = null;
      await this.repository.update(saved.id, { publishedDocumentId: null });
    } else if (status === ReferenceAnswerStatus.ACTIVE) {
      const documentId = await this.publisher.publish(saved);
      saved.publishedDocumentId = documentId;
      await this.repository.update(saved.id, { publishedDocumentId: documentId });
    }
    return saved;
  }

  // TODO(QIR-687-followup): upgrade to full LLM-backed anonymize once
  // AnonymizerLlmProvider ships a working JSON-contract system prompt, then
  // reject when dataClass !== NoPii. Current regex-only scan covers
  // email/phone/INN/SNILS/passport/bank_card/birth_date but misses person
  // names (ФИО). Admin-authored content, defense-in-depth is acceptable.
  private assertNoPii(question: string, answer: string, topic: string): void {
    const combined = [question, answer, topic].join('\n');
    const scan = this.piiAnonymizer.scanText(combined);
    if (scan.hasPii) {
      throw new BadRequestException({
        message: PII_ERROR_MESSAGE,
        piiStats: scan.stats,
      });
    }
  }

  private async assertSourceDocumentExists(documentId: string): Promise<void> {
    const exists = await this.documentRepository.exists({ where: { id: documentId } });
    if (!exists) {
      throw new NotFoundException(SOURCE_DOCUMENT_NOT_FOUND);
    }
  }
}
