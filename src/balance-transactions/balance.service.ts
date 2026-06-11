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

export interface OrderPaymentSplit {
  fromGift: number;
  fromMain: number;
}

export function computeOrderPaymentSplit(
  orderAmount: number,
  breakdown: UserBalanceBreakdown,
  maxGiftAmount: number,
): OrderPaymentSplit {
  const maxGiftDebit = Math.max(0, Math.min(orderAmount, maxGiftAmount));
  const fromGift = Math.min(breakdown.gift, maxGiftDebit);
  return {
    fromGift,
    fromMain: orderAmount - fromGift,
  };
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

  async getBalanceBreakdown(userId: string, manager?: EntityManager): Promise<UserBalanceBreakdown> {
    const userRepo = manager ? manager.getRepository(User) : this.userRepository;
    const txRepo = manager ? manager.getRepository(BalanceTransaction) : this.balanceTransactionRepository;
    const user = await userRepo.findOne({ where: { id: userId }, select: ['id', 'balance'] });
    if (!user) {
      throw new NotFoundException(`Пользователь с ID ${userId} не найден`);
    }
    const total = Number(user.balance);
    const raw = await txRepo
      .createQueryBuilder('t')
      .select(
        `COALESCE(SUM(CASE WHEN t."amount" > 0 AND (t."pocket" = :gift OR t."type" = :registrationBonus) THEN t."amount" ELSE 0 END), 0)`,
        'giftCredits',
      )
      .addSelect(
        `COALESCE(SUM(CASE WHEN t."amount" > 0 AND NOT (t."pocket" = :gift OR t."type" = :registrationBonus) THEN t."amount" ELSE 0 END), 0)`,
        'mainCredits',
      )
      .addSelect(
        `COALESCE(SUM(CASE WHEN t."amount" < 0 AND t."pocket" = :gift THEN -t."amount" ELSE 0 END), 0)`,
        'giftDebits',
      )
      .addSelect(
        `COALESCE(SUM(CASE WHEN t."amount" < 0 AND t."pocket" = :main THEN -t."amount" ELSE 0 END), 0)`,
        'mainDebits',
      )
      .addSelect(
        `COALESCE(SUM(CASE WHEN t."amount" < 0 AND t."pocket" IS NULL THEN -t."amount" ELSE 0 END), 0)`,
        'unassignedDebits',
      )
      .where('t."userId" = :userId', { userId })
      .setParameter('gift', BalancePocket.Gift)
      .setParameter('main', BalancePocket.Main)
      .setParameter('registrationBonus', BalanceTransactionType.RegistrationBonus)
      .getRawOne<{
        giftCredits: string | number;
        mainCredits: string | number;
        giftDebits: string | number;
        mainDebits: string | number;
        unassignedDebits: string | number;
      }>();

    const giftCredits = Number(raw?.giftCredits ?? 0);
    const mainCredits = Number(raw?.mainCredits ?? 0);
    const giftDebits = Number(raw?.giftDebits ?? 0);
    const mainDebits = Number(raw?.mainDebits ?? 0);
    const unassignedDebits = Number(raw?.unassignedDebits ?? 0);

    let giftRemaining = Math.max(0, giftCredits - giftDebits);
    const fromGiftUnassigned = Math.min(giftRemaining, unassignedDebits);
    giftRemaining -= fromGiftUnassigned;
    const unassignedLeft = unassignedDebits - fromGiftUnassigned;

    let mainRemaining = Math.max(0, mainCredits - mainDebits - unassignedLeft);

    giftRemaining = Math.min(giftRemaining, total);
    mainRemaining = Math.min(mainRemaining, Math.max(0, total - giftRemaining));
    if (giftRemaining + mainRemaining < total - 0.01) {
      mainRemaining = Math.max(0, total - giftRemaining);
    }

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

  assertSufficientBalanceForOrder(
    amount: number,
    breakdown: UserBalanceBreakdown,
    maxGiftAmount: number,
  ): void {
    if (amount <= 0) {
      throw new BadRequestException('Сумма оплаты должна быть больше нуля');
    }
    if (breakdown.total < amount) {
      throw new BadRequestException(
        `Недостаточно средств на балансе. Доступно: ${breakdown.total} ₽, требуется: ${amount} ₽`,
      );
    }

    const maxGiftDebit = Math.max(0, Math.min(amount, maxGiftAmount));
    const { fromMain } = computeOrderPaymentSplit(amount, breakdown, maxGiftDebit);
    if (breakdown.main < fromMain - 0.01) {
      throw new BadRequestException(
        `Недостаточно средств на основном балансе. С подарочного можно оплатить не более ${maxGiftDebit} ₽ `
        + `(по gift-eligible позициям), с основного требуется ${fromMain} ₽, доступно ${breakdown.main} ₽`,
      );
    }
  }

  async debitForOrderPayment(
    userId: string,
    amount: number,
    meta: Pick<AddToBalanceMeta, 'orderId' | 'description'>,
    options: { maxGiftAmount: number },
    manager?: EntityManager,
  ): Promise<BalanceTransaction[]> {
    const breakdown = await this.getBalanceBreakdown(userId, manager);
    this.assertSufficientBalanceForOrder(amount, breakdown, options.maxGiftAmount);

    const { fromGift, fromMain } = computeOrderPaymentSplit(
      amount,
      breakdown,
      options.maxGiftAmount,
    );
    const transactions: BalanceTransaction[] = [];

    if (fromGift > 0) {
      transactions.push(
        await this.addToBalance(
          userId,
          -fromGift,
          BalanceTransactionType.OrderPayment,
          { ...meta, pocket: BalancePocket.Gift },
          manager,
        ),
      );
    }
    if (fromMain > 0) {
      transactions.push(
        await this.addToBalance(
          userId,
          -fromMain,
          BalanceTransactionType.OrderPayment,
          { ...meta, pocket: BalancePocket.Main },
          manager,
        ),
      );
    }

    return transactions;
  }
}
