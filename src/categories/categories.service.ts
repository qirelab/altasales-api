import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, DataSource, Repository } from 'typeorm';
import { FAQ } from '../services/entities/faq.entity';
import { CreateAdminCategoryDto } from './dto/create-admin-category.dto';
import { GetAdminCategoriesQueryDto } from './dto/get-admin-categories-query.dto';
import { UpdateAdminCategoryDto } from './dto/update-admin-category.dto';
import { Category } from './entities/category.entity';

type AdminCategoryWithCounts = Category & {
  servicesCount: number;
  packagesCount: number;
  faqsCount: number;
};

@Injectable()
export class CategoriesService {
  constructor(
    @InjectRepository(Category)
    private readonly categoryRepository: Repository<Category>,
    @InjectRepository(FAQ)
    private readonly faqRepository: Repository<FAQ>,
    private readonly dataSource: DataSource,
  ) { }

  async findAll(): Promise<Category[]> {
    return this.categoryRepository.find({
      order: { name: 'ASC' },
      select: ['id', 'name', 'slug'],
    });
  }

  async findBySlug(slug: string): Promise<Category> {
    const normalizedSlug = this.normalizeSlug(slug);
    const category = await this.categoryRepository.findOne({
      where: { slug: normalizedSlug },
      relations: ['faqs'],
    });

    if (!category) {
      throw new NotFoundException(`Категория со slug "${slug}" не найдена`);
    }

    return category;
  }

  async findAllForAdmin(query: GetAdminCategoriesQueryDto): Promise<{
    data: AdminCategoryWithCounts[];
    total: number;
    offset: number;
    limit: number;
  }> {
    const { offset = 0, limit = 20 } = query;
    const search = query.search?.trim();

    const countQb = this.categoryRepository.createQueryBuilder('c');

    if (search) {
      countQb.where(
        new Brackets((sub) => {
          sub
            .where('c.name ILIKE :search', { search: `%${search}%` })
            .orWhere('c.slug ILIKE :search', { search: `%${search}%` })
            .orWhere('c.description ILIKE :search', { search: `%${search}%` });
        }),
      );
    }

    const total = await countQb.getCount();

    const dataQb = this.categoryRepository
      .createQueryBuilder('c')
      .loadRelationCountAndMap('c.servicesCount', 'c.services')
      .loadRelationCountAndMap('c.packagesCount', 'c.packages')
      .loadRelationCountAndMap('c.faqsCount', 'c.faqs');

    if (search) {
      dataQb.where(
        new Brackets((sub) => {
          sub
            .where('c.name ILIKE :search', { search: `%${search}%` })
            .orWhere('c.slug ILIKE :search', { search: `%${search}%` })
            .orWhere('c.description ILIKE :search', { search: `%${search}%` });
        }),
      );
    }

    const categories = await dataQb
      .orderBy('c.name', 'ASC')
      .skip(offset)
      .take(limit)
      .getMany();

    return { data: categories as AdminCategoryWithCounts[], total, offset, limit };
  }

  async findOneForAdmin(id: string): Promise<AdminCategoryWithCounts> {
    const category = await this.categoryRepository
      .createQueryBuilder('c')
      .leftJoinAndSelect('c.faqs', 'faq')
      .loadRelationCountAndMap('c.servicesCount', 'c.services')
      .loadRelationCountAndMap('c.packagesCount', 'c.packages')
      .loadRelationCountAndMap('c.faqsCount', 'c.faqs')
      .where('c.id = :id', { id })
      .getOne();

    if (!category) {
      throw new NotFoundException(`Категория с ID ${id} не найдена`);
    }

    return category as AdminCategoryWithCounts;
  }

  async createForAdmin(dto: CreateAdminCategoryDto): Promise<Category> {
    const name = dto.name.trim();
    const slug = this.normalizeSlug(dto.slug);
    const description = this.normalizeDescription(dto.description);

    await this.ensureUniqueNameAndSlug(name, slug);

    return this.dataSource.transaction(async (manager) => {
      const categoryRepo = manager.getRepository(Category);
      const faqRepo = manager.getRepository(FAQ);

      const category = await categoryRepo.save(
        categoryRepo.create({ name, slug, description }),
      );

      if (dto.faqs?.length) {
        await this.replaceFaqs(category.id, dto.faqs, faqRepo);
      }

      return categoryRepo.findOneOrFail({
        where: { id: category.id },
        relations: ['faqs'],
      });
    });
  }

  async updateForAdmin(id: string, dto: UpdateAdminCategoryDto): Promise<Category> {
    const category = await this.categoryRepository.findOne({
      where: { id },
      relations: ['faqs'],
    });

    if (!category) {
      throw new NotFoundException(`Категория с ID ${id} не найдена`);
    }

    const name = dto.name !== undefined ? dto.name.trim() : category.name;
    const slug = dto.slug !== undefined ? this.normalizeSlug(dto.slug) : category.slug;
    const description = dto.description !== undefined
      ? this.normalizeDescription(dto.description)
      : category.description;

    if (name !== category.name || slug !== category.slug) {
      await this.ensureUniqueNameAndSlug(name, slug, id);
    }

    return this.dataSource.transaction(async (manager) => {
      const categoryRepo = manager.getRepository(Category);
      const faqRepo = manager.getRepository(FAQ);

      await categoryRepo.update(id, { name, slug, description });

      if (dto.faqs !== undefined) {
        await this.replaceFaqs(id, dto.faqs, faqRepo);
      }

      return categoryRepo.findOneOrFail({
        where: { id },
        relations: ['faqs'],
      });
    });
  }

  async removeForAdmin(id: string): Promise<void> {
    const category = await this.categoryRepository.findOne({ where: { id } });

    if (!category) {
      throw new NotFoundException(`Категория с ID ${id} не найдена`);
    }

    await this.categoryRepository.remove(category);
  }

  private normalizeSlug(slug: string): string {
    return slug.trim().toLowerCase();
  }

  private normalizeDescription(description?: string | null): string | null {
    if (description === undefined || description === null) {
      return null;
    }

    const trimmed = description.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  private async ensureUniqueNameAndSlug(
    name: string,
    slug: string,
    excludeId?: string,
  ): Promise<void> {
    const qb = this.categoryRepository
      .createQueryBuilder('c')
      .where('c.name = :name OR c.slug = :slug', { name, slug });

    if (excludeId) {
      qb.andWhere('c.id != :excludeId', { excludeId });
    }

    const conflict = await qb.getOne();

    if (!conflict) {
      return;
    }

    if (conflict.name === name) {
      throw new ConflictException('Категория с таким названием уже существует');
    }

    throw new ConflictException('Категория с таким slug уже существует');
  }

  private async replaceFaqs(
    categoryId: string,
    faqs: Array<{ id?: string; question: string; answer: string }>,
    faqRepo: Repository<FAQ>,
  ): Promise<void> {
    const existing = await faqRepo.find({ where: { categoryId } });
    const existingById = new Map(existing.map((faq) => [faq.id, faq]));
    const incomingIds = new Set(
      faqs.map((item) => item.id).filter((faqId): faqId is string => Boolean(faqId)),
    );

    const toRemove = existing.filter((faq) => !incomingIds.has(faq.id));
    if (toRemove.length > 0) {
      await faqRepo.remove(toRemove);
    }

    for (const item of faqs) {
      const question = item.question.trim();
      const answer = item.answer.trim();

      if (item.id) {
        const faq = existingById.get(item.id);
        if (!faq) {
          throw new BadRequestException(`FAQ с ID ${item.id} не найден в этой категории`);
        }

        faq.question = question;
        faq.answer = answer;
        await faqRepo.save(faq);
        continue;
      }

      await faqRepo.save(
        faqRepo.create({
          categoryId,
          question,
          answer,
        }),
      );
    }
  }
}
