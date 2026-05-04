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
import { BalancePocket } from './balance-pocket.enum';
import { User } from './user.entity';

@Entity()
export class BalanceTransaction {
  @ApiProperty({
    example: '550e8400-e29b-41d4-a716-446655440000',
    description: 'Transaction ID',
  })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({
    example: '550e8400-e29b-41d4-a716-446655440000',
    description: 'User ID',
  })
  @Column({ type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @ApiProperty({
    example: 500.5,
    description: 'Сумма: >0 начисление на общий баланс, <0 списание',
  })
  @Column({ type: 'decimal', precision: 12, scale: 2 })
  amount: number;

  @ApiProperty({
    enum: BalancePocket,
    nullable: true,
    description:
      'Для начислений (amount > 0): основной или подарочный источник. Для списаний обычно null.',
  })
  @Column({ type: 'varchar', length: 10, nullable: true })
  pocket: BalancePocket | null;

  @ApiProperty({ enum: BalanceTransactionType, description: 'Transaction type' })
  @Column({ type: 'varchar', length: 20 })
  type: BalanceTransactionType;

  @ApiProperty({
    example: '550e8400-e29b-41d4-a716-446655440000',
    description: 'Related order ID',
  })
  @Column({ type: 'uuid', nullable: true })
  orderId: string | null;

  @ApiProperty({ example: 12345, description: 'Related payment InvId' })
  @Column({ type: 'int', nullable: true })
  paymentInvId: number | null;

  @ApiProperty({ example: 'Пополнение по оплате заказа №5', description: 'Description' })
  @Column({ type: 'varchar', length: 255, nullable: true })
  description: string | null;

  @CreateDateColumn()
  createdAt: Date;
}
