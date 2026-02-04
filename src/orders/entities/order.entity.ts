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
import { OrderStatus } from './order-status.enum';
import { OrderItem } from './order-item.entity';
import { User } from '../../users/entities/user.entity';

@Entity()
export class Order {
  @ApiProperty({ example: 1, description: 'Order ID' })
  @PrimaryGeneratedColumn()
  id: number;

  @ApiProperty({ example: 1, description: 'User ID (order author)' })
  @Column()
  userId: number;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
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

  @OneToMany(() => OrderItem, (item: OrderItem) => item.order)
  items: OrderItem[];
}
