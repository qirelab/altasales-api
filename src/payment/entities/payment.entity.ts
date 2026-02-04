import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';

export enum PaymentStatus {
  Pending = 'pending',
  Paid = 'paid',
  Failed = 'failed',
}

@Entity()
export class Payment {
  @ApiProperty({ example: 1, description: 'Payment record ID' })
  @PrimaryGeneratedColumn()
  id: number;

  @ApiProperty({ example: 12345, description: 'Invoice ID (InvId) for Robokassa' })
  @Column({ unique: true })
  invId: number;

  @ApiProperty({ example: 1, description: 'Order ID this payment belongs to' })
  @Column({ type: 'int', nullable: true })
  orderId: number | null;

  @ApiProperty({ example: 990.5, description: 'Payment amount' })
  @Column({ type: 'decimal', precision: 12, scale: 2 })
  outSum: number;

  @ApiProperty({ example: 'Оплата заказа №12', description: 'Payment description' })
  @Column({ type: 'varchar', length: 255 })
  description: string;

  @ApiProperty({ enum: PaymentStatus, description: 'Payment status' })
  @Column({ type: 'varchar', length: 20, default: PaymentStatus.Pending })
  status: PaymentStatus;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
