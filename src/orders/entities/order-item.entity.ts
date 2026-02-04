import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Order } from './order.entity';
import { Service } from '../../services/entities/service.entity';

@Entity()
export class OrderItem {
  @ApiProperty({ example: 1, description: 'Order item ID' })
  @PrimaryGeneratedColumn()
  id: number;

  @ApiProperty({ example: 1, description: 'Order ID' })
  @Column()
  orderId: number;

  @ManyToOne(() => Order, (order) => order.items, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'orderId' })
  order: Order;

  @ApiProperty({ example: 1, description: 'Service ID' })
  @Column()
  serviceId: number;

  @ManyToOne(() => Service, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'serviceId' })
  service: Service;

  @ApiPropertyOptional({ example: 10, description: 'Hours (contractor only)' })
  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  hours: number | null;

  @ApiProperty({ example: 50000, description: 'Line total amount' })
  @Column({ type: 'decimal', precision: 12, scale: 2 })
  amount: number;
}
