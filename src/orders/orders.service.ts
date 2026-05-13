import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, DataSource, Repository } from 'typeorm';
import { PaymentService } from '../payment/payment.service';
import { User } from '../users/entities/user.entity';
import { Order } from './entities/order.entity';
import { OrderItem } from './entities/order-item.entity';
import { OrderStatus } from './entities/order-status.enum';
import { CheckoutDto } from './dto/checkout.dto';
import { CheckoutPaymentMethod } from './dto/checkout-payment-method.enum';
import { GetAdminOrdersQueryDto } from './dto/get-admin-orders-query.dto';
import { GetOrdersQueryDto } from './dto/get-orders-query.dto';
import { UpdateContractorChatAccessDto } from './dto/update-contractor-chat-access.dto';
import { BalanceService } from '../balance-transactions/balance.service';
import { BalanceTransactionType } from '../balance-transactions/entities/balance-transaction-type.enum';
import { CartService } from '../cart/cart.service';

@Injectable()
export class OrdersService {
  constructor(
    @InjectRepository(Order)
    private readonly orderRepository: Repository<Order>,
    @InjectRepository(OrderItem)
    private readonly orderItemRepository: Repository<OrderItem>,
    private readonly paymentService: PaymentService,
    private readonly dataSource: DataSource,
    private readonly balanceService: BalanceService,
    private readonly cartService: CartService,
  ) { }

  async checkout(dto: CheckoutDto, userId: string): Promise<{
    orderId: string;
    status: OrderStatus;
    paymentMethod: CheckoutPaymentMethod;
    paymentUrl?: string;
    params?: Record<string, string | number>;
  }> {
    if (!dto.items?.length) {
      throw new BadRequestException('Order must have at least one item');
    }

    const paymentMethod = dto.paymentMethod ?? CheckoutPaymentMethod.Robokassa;
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const order = this.orderRepository.create({
        userId,
        amount: dto.amount,
        deadline: new Date(dto.deadline),
        comments: dto.comments ?? undefined,
        status: OrderStatus.PendingPayment,
      });
      await queryRunner.manager.save(Order, order);

      const items = dto.items.map((item) =>
        this.orderItemRepository.create({
          orderId: order.id,
          serviceId: item.serviceId,
          hours: item.hours ?? null,
          amount: item.amount,
        }),
      );
      await queryRunner.manager.save(OrderItem, items);

      if (paymentMethod === CheckoutPaymentMethod.Balance) {
        await this.balanceService.addToBalance(
          userId,
          -Number(dto.amount),
          BalanceTransactionType.OrderPayment,
          {
            orderId: order.id,
            description: `Оплата заказа №${order.id} с внутреннего баланса`,
          },
          queryRunner.manager,
        );
        await queryRunner.manager.update(
          Order,
          { id: order.id },
          { status: OrderStatus.InProgress },
        );
        await this.cartService.clearAndArchiveActiveCart(userId);
        await queryRunner.commitTransaction();
        return {
          orderId: order.id,
          status: OrderStatus.InProgress,
          paymentMethod: CheckoutPaymentMethod.Balance,
        };
      }

      const { paymentUrl, params } = await this.paymentService.createWithManager(
        {
          orderId: order.id,
          outSum: dto.amount,
          description: `Оплата заказа №${order.id}`,
        },
        queryRunner.manager,
      );

      await queryRunner.commitTransaction();
      return {
        orderId: order.id,
        status: OrderStatus.PendingPayment,
        paymentMethod: CheckoutPaymentMethod.Robokassa,
        paymentUrl,
        params,
      };
    } catch (err) {
      await queryRunner.rollbackTransaction();
      throw err;
    } finally {
      await queryRunner.release();
    }
  }

  async findByUserId(
    userId: string,
    query: GetOrdersQueryDto,
  ): Promise<{ data: Order[]; total: number; offset: number; limit: number }> {
    const { status, offset = 0, limit = 20 } = query;
    const where: { userId: string; status?: OrderStatus } = { userId };
    if (status) where.status = status;

    const [data, total] = await this.orderRepository.findAndCount({
      where,
      relations: ['items', 'items.service'],
      order: { createdAt: 'DESC' },
      skip: offset,
      take: limit,
    });
    return { data, total, offset, limit };
  }

  async findAllForAdmin(query: GetAdminOrdersQueryDto): Promise<{
    data: Array<{
      id: string;
      itemsCount: number;
      clientName: string;
      clientLastName: string;
      date: Date;
      amount: number;
      status: OrderStatus;
      contractorChatAccess: boolean;
    }>;
    total: number;
    offset: number;
    limit: number;
  }> {
    const { offset = 0, limit = 20 } = query;
    const search = query.search?.trim();

    const baseQb = this.orderRepository
      .createQueryBuilder('o')
      .leftJoin(User, 'u', 'u.id = o."userId"');

    if (search) {
      baseQb.andWhere(
        new Brackets((qb) => {
          qb
            .where('o.id::text ILIKE :search', { search: `%${search}%` })
            .orWhere('o.status ILIKE :search', { search: `%${search}%` })
            .orWhere('u.name ILIKE :search', { search: `%${search}%` })
            .orWhere('u."lastName" ILIKE :search', { search: `%${search}%` })
            .orWhere(`CONCAT(u.name, ' ', u."lastName") ILIKE :search`, {
              search: `%${search}%`,
            });
        }),
      );
    }

    const total = await baseQb.getCount();

    const rows = await baseQb
      .clone()
      .leftJoin('o.items', 'item')
      .select('o.id', 'id')
      .addSelect('COUNT(item.id)', 'itemsCount')
      .addSelect('u.name', 'clientName')
      .addSelect('u."lastName"', 'clientLastName')
      .addSelect('o."createdAt"', 'date')
      .addSelect('o.amount', 'amount')
      .addSelect('o.status', 'status')
      .addSelect('o."contractorChatAccess"', 'contractorChatAccess')
      .groupBy('o.id')
      .addGroupBy('u.name')
      .addGroupBy('u."lastName"')
      .orderBy('o."createdAt"', 'DESC')
      .offset(offset)
      .limit(limit)
      .getRawMany<{
        id: string;
        itemsCount: string;
        clientName: string;
        clientLastName: string;
        date: Date;
        amount: string;
        status: OrderStatus;
        contractorChatAccess: boolean;
      }>();

    return {
      data: rows.map((row) => ({
        id: row.id,
        itemsCount: Number(row.itemsCount),
        clientName: row.clientName,
        clientLastName: row.clientLastName,
        date: row.date,
        amount: Number(row.amount),
        status: row.status,
        contractorChatAccess: row.contractorChatAccess,
      })),
      total,
      offset,
      limit,
    };
  }

  async findOneForAdmin(id: string): Promise<Order> {
    const order = await this.orderRepository.findOne({
      where: { id },
      relations: ['user', 'items', 'items.service'],
      order: { items: { id: 'ASC' } },
    });

    if (!order) {
      throw new NotFoundException(`Order with id ${id} not found`);
    }

    return order;
  }

  async removeForAdmin(id: string): Promise<void> {
    const order = await this.orderRepository.findOne({ where: { id } });
    if (!order) {
      throw new NotFoundException(`Order with id ${id} not found`);
    }

    await this.orderRepository.remove(order);
  }

  async updateContractorChatAccessForAdmin(
    id: string,
    dto: UpdateContractorChatAccessDto,
  ): Promise<Order> {
    const order = await this.orderRepository.findOne({ where: { id } });
    if (!order) {
      throw new NotFoundException(`Order with id ${id} not found`);
    }

    order.contractorChatAccess = dto.contractorChatAccess;
    return this.orderRepository.save(order);
  }

  async getOrderCountsByUserId(userId: string): Promise<{
    active: number;
    completed: number;
    cancelled: number;
  }> {
    const raw = await this.orderRepository
      .createQueryBuilder('o')
      .select('o.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .where('o.userId = :userId', { userId })
      .groupBy('o.status')
      .getRawMany<{ status: OrderStatus; count: string }>();
    const map = Object.fromEntries(raw.map((r) => [r.status, Number(r.count)]));
    return {
      active:
        (map[OrderStatus.PendingPayment] ?? 0) + (map[OrderStatus.InProgress] ?? 0),
      completed: map[OrderStatus.Completed] ?? 0,
      cancelled: map[OrderStatus.Cancelled] ?? 0,
    };
  }
}
