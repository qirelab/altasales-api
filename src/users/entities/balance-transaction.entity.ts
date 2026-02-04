import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';
import { BalanceTransactionType } from './balance-transaction-type.enum';
import { User } from './user.entity';

@Entity()
export class BalanceTransaction {
  @ApiProperty({ example: 1, description: 'Transaction ID' })
  @PrimaryGeneratedColumn()
  id: number;

  @ApiProperty({ example: 1, description: 'User ID' })
  @Column()
  userId: number;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @ApiProperty({ example: 500.5, description: 'Amount (positive = credit, negative = debit)' })
  @Column({ type: 'decimal', precision: 12, scale: 2 })
  amount: number;

  @ApiProperty({ enum: BalanceTransactionType, description: 'Transaction type' })
  @Column({ type: 'varchar', length: 20 })
  type: BalanceTransactionType;

  @ApiProperty({ example: 1, description: 'Related order ID' })
  @Column({ type: 'int', nullable: true })
  orderId: number | null;

  @ApiProperty({ example: 12345, description: 'Related payment InvId' })
  @Column({ type: 'int', nullable: true })
  paymentInvId: number | null;

  @ApiProperty({ example: 'Пополнение по оплате заказа №5', description: 'Description' })
  @Column({ type: 'varchar', length: 255, nullable: true })
  description: string | null;

  @CreateDateColumn()
  createdAt: Date;
}
