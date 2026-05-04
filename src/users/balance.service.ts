import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { User } from './entities/user.entity';
import { BalanceTransaction } from './entities/balance-transaction.entity';
import { BalanceTransactionType } from './entities/balance-transaction-type.enum';
import { BalancePocket } from './entities/balance-pocket.enum';

export interface AddToBalanceMeta {
  orderId?: string | null;
  paymentInvId?: number | null;
  description?: string | null;
  /**
   * Только смысл для начислений (amount > 0): отметить основной или подарочный источник.
   * Не дублирует отдельный кошелёк — меняется один общий balance.
   */
  pocket?: BalancePocket | null;
}

@Injectable()
export class BalanceService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(BalanceTransaction)
    private readonly balanceTransactionRepository: Repository<BalanceTransaction>,
  ) { }

  async getBalance(userId: string): Promise<number> {
    const user = await this.userRepository.findOne({ where: { id: userId }, select: ['id', 'balance'] });
    if (!user) {
      throw new NotFoundException(`Пользователь с ID ${userId} не найден`);
    }
    return Number(user.balance);
  }

  async addToBalance(
    userId: string,
    amount: number,
    type: BalanceTransactionType,
    meta: AddToBalanceMeta = {},
    manager?: EntityManager,
  ): Promise<BalanceTransaction> {
    if (amount === 0) {
      throw new BadRequestException('Сумма не может быть нулевой');
    }
    const userRepo = manager ? manager.getRepository(User) : this.userRepository;
    const txRepo = manager ? manager.getRepository(BalanceTransaction) : this.balanceTransactionRepository;

    const user = await userRepo.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException(`Пользователь с ID ${userId} не найден`);
    }
    const newBalance = Number(user.balance) + amount;
    if (newBalance < 0) {
      throw new BadRequestException('Недостаточно средств на балансе');
    }

    await userRepo.update({ id: userId }, { balance: newBalance });

    const pocket =
      amount > 0 ? meta.pocket ?? BalancePocket.Main : meta.pocket ?? null;

    const transaction = txRepo.create({
      userId,
      amount,
      pocket,
      type,
      orderId: meta.orderId ?? null,
      paymentInvId: meta.paymentInvId ?? null,
      description: meta.description ?? null,
    });
    return txRepo.save(transaction);
  }

  async getTransactions(userId: string): Promise<BalanceTransaction[]> {
    return this.balanceTransactionRepository.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });
  }

  async creditFromPayment(
    userId: string,
    amount: number,
    paymentInvId: number,
    orderId: string | null,
    description: string,
    manager?: EntityManager,
    pocket: BalancePocket = BalancePocket.Main,
  ): Promise<BalanceTransaction> {
    return this.addToBalance(
      userId,
      amount,
      BalanceTransactionType.TopUp,
      { orderId, paymentInvId, description, pocket },
      manager,
    );
  }
}
