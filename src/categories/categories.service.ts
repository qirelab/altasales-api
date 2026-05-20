import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Category } from './entities/category.entity';

@Injectable()
export class CategoriesService {
  constructor(
    @InjectRepository(Category)
    private readonly categoryRepository: Repository<Category>,
  ) { }

  async findAll(): Promise<Category[]> {
    return this.categoryRepository.find({
      order: { name: 'ASC' },
      select: ['id', 'name', 'slug'],
    });
  }

  async findBySlug(slug: string): Promise<Category> {
    const normalizedSlug = slug.trim().toLowerCase();
    const category = await this.categoryRepository.findOne({
      where: { slug: normalizedSlug },
      relations: ['faqs'],
    });

    if (!category) {
      throw new NotFoundException(`Категория со slug "${slug}" не найдена`);
    }

    return category;
  }
}
