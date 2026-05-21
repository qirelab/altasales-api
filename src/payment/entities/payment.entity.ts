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
  @ApiProperty({
    example: '550e8400-e29b-41d4-a716-446655440000',
    description: 'Payment record ID',
  })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ example: 12345, description: 'Invoice ID (InvId) for Robokassa' })
  @Column({ unique: true })
  invId: number;

  @ApiProperty({
    example: '550e8400-e29b-41d4-a716-446655440000',
    description: 'Order ID this payment belongs to',
  })
  @Column({ type: 'uuid', nullable: true })
  orderId: string | null;

  @ApiProperty({
    description: 'Order IDs linked to this payment (batch checkout)',
    type: [String],
    required: false,
  })
  @Column({ type: 'json', nullable: true })
  orderIds: string[] | null;

  @ApiProperty({
    example: '550e8400-e29b-41d4-a716-446655440000',
    description: 'User ID для пополнения баланса',
    nullable: true,
  })
  @Column({ type: 'uuid', nullable: true })
  userId: string | null;

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
