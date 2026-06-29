import { ApiProperty } from '@nestjs/swagger';
import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Category } from '../../categories/entities/category.entity';

@Entity()
export class FAQ {
  @ApiProperty({
    example: '550e8400-e29b-41d4-a716-446655440000',
    description: 'FAQ ID',
  })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({
    example: 'Сколько длится внедрение?',
    description: 'FAQ question',
  })
  @Column({ type: 'text' })
  question: string;

  @ApiProperty({
    example: 'Обычно от 2 до 6 недель в зависимости от сложности проекта.',
    description: 'FAQ answer',
  })
  @Column({ type: 'text' })
  answer: string;

  @ApiProperty({
    example: '550e8400-e29b-41d4-a716-446655440001',
    description: 'Category ID to which FAQ belongs',
  })
  @Column({ type: 'uuid' })
  categoryId: string;

  @ApiProperty({
    example: 0,
    description: 'Position within the category FAQ list (lower = earlier)',
  })
  @Column({ type: 'int', default: 0 })
  sortOrder: number;

  @ManyToOne(() => Category, (category) => category.faqs, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'categoryId' })
  category: Category;
}
