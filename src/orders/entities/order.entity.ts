import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  OneToMany,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';
import { User } from '../../users/entities/user.entity';
import { OrderStatus } from './order-status.enum';
import { OrderItem } from './order-item.entity';

@Entity()
export class Order {
  @ApiProperty({
    example: '550e8400-e29b-41d4-a716-446655440000',
    description: 'Order ID',
  })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({
    example: '550e8400-e29b-41d4-a716-446655440000',
    description: 'User ID (order author)',
  })
  @Column({ type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @ApiProperty({ example: '2025-02-04T12:00:00Z', description: 'Order date' })
  @CreateDateColumn()
  createdAt: Date;

  @ApiProperty({ example: 125000, description: 'Total order amount' })
  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  amount: number;

  @ApiProperty({ enum: OrderStatus, description: 'Order status' })
  @Column({ type: 'varchar', length: 20, default: OrderStatus.InProgress })
  status: OrderStatus;

  @ApiProperty({ example: '2025-02-04T12:00:00Z', description: 'Order deadline' })
  @Column({ type: 'timestamp' })
  deadline: Date;

  @ApiProperty({ example: 'Comments', description: 'Order comments' })
  @Column({ type: 'text' })
  comments?: string;

  @ApiProperty({
    example: false,
    description: 'Whether assigned contractor has access to order chat',
  })
  @Column({ type: 'boolean', default: false })
  contractorChatAccess: boolean;

  @OneToMany(() => OrderItem, (item: OrderItem) => item.order)
  items: OrderItem[];
}
