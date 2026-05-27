import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { User } from '../users/entities/user.entity';
import { BalanceTransaction } from './entities/balance-transaction.entity';
import { BalanceTransactionType } from './entities/balance-transaction-type.enum';
import { BalancePocket } from './entities/balance-pocket.enum';
import { REGISTRATION_GIFT_RUB } from './balance.constants';

export interface UserBalanceBreakdown {
  total: number;
  main: number;
  gift: number;
}

export interface AddToBalanceMeta {
  orderId?: string | null;
  paymentInvId?: number | null;
  description?: string | null;
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

  async getBalanceBreakdown(userId: string): Promise<UserBalanceBreakdown> {
    const user = await this.userRepository.findOne({ where: { id: userId }, select: ['id', 'balance'] });
    if (!user) {
      throw new NotFoundException(`Пользователь с ID ${userId} не найден`);
    }
    const total = Number(user.balance);
    const raw = await this.balanceTransactionRepository
      .createQueryBuilder('t')
      .select(
        `COALESCE(SUM(CASE WHEN t."amount" > 0 AND (t."pocket" = :gift OR t."type" = :registrationBonus) THEN t."amount" ELSE 0 END), 0)`,
        'giftCredits',
      )
      .addSelect(
        `COALESCE(SUM(CASE WHEN t."amount" < 0 THEN -t."amount" ELSE 0 END), 0)`,
        'debitVolume',
      )
      .where('t."userId" = :userId', { userId })
      .setParameter('gift', BalancePocket.Gift)
      .setParameter('registrationBonus', BalanceTransactionType.RegistrationBonus)
      .getRawOne<{ giftCredits: string | number; debitVolume: string | number }>();

    const giftCredits = Number(raw?.giftCredits ?? 0);
    const debitVolume = Number(raw?.debitVolume ?? 0);
    const giftConsumed = Math.min(debitVolume, giftCredits);
    const giftRemainingRaw = Math.max(0, giftCredits - giftConsumed);
    const giftRemaining = Math.min(giftRemainingRaw, total);
    const mainRemaining = total - giftRemaining;

    return {
      total,
      main: mainRemaining,
      gift: giftRemaining,
    };
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

  async hasRegistrationGift(userId: string): Promise<boolean> {
    const existing = await this.balanceTransactionRepository.findOne({
      where: { userId, type: BalanceTransactionType.RegistrationBonus },
      select: ['id'],
    });
    return Boolean(existing);
  }

  async creditRegistrationGift(userId: string, manager?: EntityManager): Promise<BalanceTransaction> {
    return this.addToBalance(
      userId,
      REGISTRATION_GIFT_RUB,
      BalanceTransactionType.RegistrationBonus,
      {
        description: 'Подарочный баланс за заполнение анкеты',
        pocket: BalancePocket.Gift,
      },
      manager,
    );
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
