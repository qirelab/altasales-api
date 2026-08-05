import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { Order } from '../orders/entities/order.entity';
import { OrderItem } from '../orders/entities/order-item.entity';
import { OrderItemSubItem } from '../orders/entities/order-item-sub-item.entity';
import { OrderStatus } from '../orders/entities/order-status.enum';
import { OrderNotificationService } from '../orders/order-notification.service';
import { CartService } from '../cart/cart.service';
import { BalanceService } from '../balance-transactions/balance.service';
import { Recommendation } from '../recommendations/entities/recommendation.entity';
import { RecommendationStatus } from '../recommendations/entities/recommendation-status.enum';
import { RecommendationUserLockService } from '../recommendations/recommendation-user-lock.service';
import { RopSubscriptionService } from '../rop/rop-subscription.service';
import { CreateTopUpPaymentDto } from './dto/create-topup-payment.dto';
import { RobokassaService } from './robokassa.service';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { Payment, PaymentStatus } from './entities/payment.entity';

@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name);

  constructor(
    @InjectRepository(Payment)
    private readonly paymentRepository: Repository<Payment>,
    @InjectRepository(Order)
    private readonly orderRepository: Repository<Order>,
    private readonly robokassaService: RobokassaService,
    private readonly dataSource: DataSource,
    private readonly cartService: CartService,
    private readonly balanceService: BalanceService,
    private readonly orderNotificationService: OrderNotificationService,
    private readonly recommendationUserLockService: RecommendationUserLockService,
    private readonly ropSubscriptionService: RopSubscriptionService,
  ) {}

  async createWithManager(
    dto: CreatePaymentDto,
    manager: EntityManager,
  ): Promise<{ paymentUrl: string; params: Record<string, string | number> }> {
    const paymentRepo = manager.getRepository(Payment);

    let invId = dto.invId;
    if (invId == null) {
      const last = await paymentRepo
        .createQueryBuilder('p')
        .select('MAX(p.invId)', 'max')
        .getRawOne<{ max: number | null }>();
      invId = (last?.max ?? 0) + 1;
    } else {
      const existing = await paymentRepo.findOne({ where: { invId } });
      if (existing) {
        throw new BadRequestException(
          `Payment with InvId ${invId} already exists`,
        );
      }
    }

    const payment = paymentRepo.create({
      invId,
      orderId: dto.orderId ?? null,
      orderIds: dto.orderIds ?? null,
      userId: dto.userId ?? null,
      outSum: dto.outSum,
      description: dto.description,
      status: PaymentStatus.Pending,
    });
    await paymentRepo.save(payment);

    const params = this.robokassaService.buildPaymentParams(
      Number(dto.outSum),
      invId,
      dto.description,
    );
    const paymentUrl = params.paymentUrl;
    const formParams = {
      MerchantLogin: params.MerchantLogin,
      OutSum: params.OutSum,
      InvId: params.InvId,
      Description: params.Description,
      SignatureValue: params.SignatureValue,
      IsTest: params.IsTest,
    };
    return { paymentUrl, params: formParams };
  }

  async createTopUpPayment(
    userId: string,
    dto: CreateTopUpPaymentDto,
  ): Promise<{ paymentUrl: string; params: Record<string, string | number> }> {
    const description =
      dto.description?.trim() || 'Пополнение внутреннего баланса';
    return this.createWithManager(
      {
        userId,
        outSum: dto.amount,
        description,
      },
      this.dataSource.manager,
    );
  }

  async findByInvId(invId: number): Promise<Payment> {
    const payment = await this.paymentRepository.findOne({ where: { invId } });
    if (!payment) {
      throw new NotFoundException(`Payment with InvId ${invId} not found`);
    }
    return payment;
  }

  async markPaid(invId: number): Promise<void> {
    const payment = await this.findByInvId(invId);
    payment.status = PaymentStatus.Paid;
    await this.paymentRepository.save(payment);
  }

  async handleResultCallback(
    body: Record<string, string>,
  ): Promise<{ response: string }> {
    const outSum = body.OutSum;
    const invId = body.InvId;
    const signatureValue = body.SignatureValue;

    if (!outSum || !invId || !signatureValue) {
      return {
        response: `bad request: missing OutSum, InvId or SignatureValue`,
      };
    }

    const shpParams = this.robokassaService.extractShpParams(body);
    const isValid = this.robokassaService.verifyResultSignature(
      outSum,
      invId,
      signatureValue,
      Object.keys(shpParams).length > 0 ? shpParams : undefined,
    );

    if (!isValid) {
      return { response: `bad signature` };
    }

    const invIdNum = parseInt(invId, 10);
    if (Number.isNaN(invIdNum)) {
      return { response: `bad InvId` };
    }

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    let notifyOrderIds: string[] = [];

    try {
      const paymentRepo = queryRunner.manager.getRepository(Payment);
      const orderRepo = queryRunner.manager.getRepository(Order);
      const orderItemRepo = queryRunner.manager.getRepository(OrderItem);
      const recommendationRepo =
        queryRunner.manager.getRepository(Recommendation);

      const payment = await paymentRepo.findOne({ where: { invId: invIdNum } });
      if (!payment) {
        await queryRunner.rollbackTransaction();
        return { response: `error: payment not found` };
      }
      if (payment.status === PaymentStatus.Paid) {
        await queryRunner.rollbackTransaction();
        return { response: `OK${invId}` };
      }

      if (Number(payment.outSum).toFixed(2) !== Number(outSum).toFixed(2)) {
        await queryRunner.rollbackTransaction();
        return { response: `bad amount` };
      }

      let affectedOrderIds: string[] = [];
      if (payment.orderIds?.length) {
        affectedOrderIds = [...payment.orderIds];
      } else if (payment.orderId != null) {
        affectedOrderIds = [payment.orderId];
      }

      let affectedOrders: Order[] = [];
      if (affectedOrderIds.length) {
        affectedOrders = await orderRepo.find({
          where: { id: In(affectedOrderIds) },
          select: { id: true, userId: true },
        });
      }
      const affectedUserIds = new Set<string>();
      if (payment.userId) affectedUserIds.add(payment.userId);
      affectedOrders.forEach((order) => affectedUserIds.add(order.userId));
      for (const affectedUserId of [...affectedUserIds].sort()) {
        await this.recommendationUserLockService.lockUser(
          affectedUserId,
          queryRunner.manager,
        );
      }

      payment.status = PaymentStatus.Paid;
      await paymentRepo.save(payment);

      if (payment.orderIds?.length) {
        notifyOrderIds = [...payment.orderIds];
        await orderRepo.update(
          { id: In(payment.orderIds) },
          { status: OrderStatus.Planned },
        );
        await orderItemRepo.update(
          { orderId: In(payment.orderIds) },
          { status: OrderStatus.Planned },
        );
        const itemIds = await orderItemRepo
          .createQueryBuilder('item')
          .select('item.id', 'id')
          .where('item."orderId" IN (:...orderIds)', {
            orderIds: payment.orderIds,
          })
          .getRawMany()
          .then((rows) => rows.map((row: { id: string }) => row.id));
        if (itemIds.length > 0) {
          await queryRunner.manager.update(
            OrderItemSubItem,
            { orderItemId: In(itemIds) },
            { status: OrderStatus.Planned },
          );
        }
        await recommendationRepo
          .createQueryBuilder()
          .update(Recommendation)
          .set({ status: RecommendationStatus.Planned })
          .where('"orderId" IN (:...orderIds)', { orderIds: payment.orderIds })
          .execute();
        const order = await orderRepo.findOne({
          where: { id: payment.orderIds[0] },
        });
        if (order) {
          await this.cartService.clearAndArchiveActiveCart(order.userId);
        }
      } else if (payment.orderId != null) {
        notifyOrderIds = [payment.orderId];
        const order = await orderRepo.findOne({
          where: { id: payment.orderId },
        });
        await orderRepo.update(
          { id: payment.orderId },
          { status: OrderStatus.Planned },
        );
        await orderItemRepo.update(
          { orderId: payment.orderId },
          { status: OrderStatus.Planned },
        );
        const singleOrderItemIds = await orderItemRepo
          .createQueryBuilder('item')
          .select('item.id', 'id')
          .where('item."orderId" = :orderId', { orderId: payment.orderId })
          .getRawMany()
          .then((rows) => rows.map((row: { id: string }) => row.id));
        if (singleOrderItemIds.length > 0) {
          await queryRunner.manager.update(
            OrderItemSubItem,
            { orderItemId: In(singleOrderItemIds) },
            { status: OrderStatus.Planned },
          );
        }
        await recommendationRepo
          .createQueryBuilder()
          .update(Recommendation)
          .set({ status: RecommendationStatus.Planned })
          .where('"orderId" = :orderId', { orderId: payment.orderId })
          .execute();
        if (order) {
          await this.cartService.clearAndArchiveActiveCart(order.userId);
        }
      }

      if (payment.userId != null) {
        await this.balanceService.creditFromPayment(
          payment.userId,
          Number(payment.outSum),
          payment.invId,
          payment.orderId ?? null,
          payment.description,
          queryRunner.manager,
        );
      }

      await queryRunner.commitTransaction();
    } catch (err) {
      console.error(err);
      await queryRunner.rollbackTransaction();
      return { response: `error: order not found` };
    } finally {
      await queryRunner.release();
    }

    if (notifyOrderIds.length) {
      try {
        await this.orderNotificationService.notifyOrderPaid(notifyOrderIds);
      } catch (notificationError) {
        this.logger.error(
          `notifyOrderPaid failed for orders ${notifyOrderIds.join(', ')}: ` +
            `${(notificationError as Error).message}`,
          (notificationError as Error).stack,
        );
      }

      this.ropSubscriptionService.scheduleSyncForOrders(notifyOrderIds);
    }

    return { response: `OK${invId}` };
  }

  async handleFailCallback(
    body: Record<string, string>,
  ): Promise<{ response: string }> {
    const outSum = body.OutSum;
    const invId = body.InvId;
    const signatureValue = body.SignatureValue;

    if (!invId) {
      return { response: 'bad request: missing InvId' };
    }

    const invIdNum = parseInt(invId, 10);
    if (Number.isNaN(invIdNum)) {
      return { response: 'bad InvId' };
    }

    if (outSum && signatureValue) {
      const shpParams = this.robokassaService.extractShpParams(body);
      const isValid = this.robokassaService.verifySuccessFailSignature(
        outSum,
        invId,
        signatureValue,
        Object.keys(shpParams).length > 0 ? shpParams : undefined,
      );

      if (!isValid) {
        return { response: 'bad signature' };
      }
    }

    const payment = await this.paymentRepository.findOne({
      where: { invId: invIdNum },
    });
    if (!payment) {
      return { response: 'error: payment not found' };
    }

    if (payment.status === PaymentStatus.Paid) {
      return { response: `OK${invId}` };
    }

    payment.status = PaymentStatus.Failed;
    await this.paymentRepository.save(payment);
    return { response: `OK${invId}` };
  }
}
