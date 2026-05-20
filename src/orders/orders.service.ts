import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, DataSource, In, Repository } from 'typeorm';
import { PaymentService } from '../payment/payment.service';
import { User } from '../users/entities/user.entity';
import { ServiceType } from '../services/entities/service-type.enum';
import { FileSource } from '../files/entities/file.entity';
import { Order } from './entities/order.entity';
import { OrderItem } from './entities/order-item.entity';
import { OrderStatus } from './entities/order-status.enum';
import { CheckoutDto } from './dto/checkout.dto';
import { CheckoutPaymentMethod } from './dto/checkout-payment-method.enum';
import { GetAdminOrdersQueryDto } from './dto/get-admin-orders-query.dto';
import { GetOrdersQueryDto } from './dto/get-orders-query.dto';
import { UpdateContractorChatAccessDto } from './dto/update-contractor-chat-access.dto';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';
import { BalanceService } from '../balance-transactions/balance.service';
import { BalanceTransactionType } from '../balance-transactions/entities/balance-transaction-type.enum';
import { CartService } from '../cart/cart.service';

export interface OrderFileDto {
  id: string;
  name: string;
  size: number;
  type: string;
  source: FileSource;
}

export interface OrderItemDto {
  id: string;
  orderId: string;
  serviceId: string;
  service: OrderItem['service'];
  hours: number | null;
  amount: number;
  files: OrderFileDto[];
}

export interface OrderDto {
  id: string;
  userId: string;
  createdAt: Date;
  amount: number;
  status: OrderStatus;
  deadline: Date;
  comments?: string | null;
  contractorChatAccess: boolean;
  item: OrderItemDto | null;
  user?: User;
}

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

  private transformOrderFiles(order: Order): OrderDto {
    return {
      id: order.id,
      userId: order.userId,
      createdAt: order.createdAt,
      amount: order.amount,
      status: order.status,
      deadline: order.deadline,
      comments: order.comments,
      contractorChatAccess: order.contractorChatAccess,
      user: order.user,
      item: order.item
        ? {
          id: order.item.id,
          orderId: order.item.orderId,
          serviceId: order.item.serviceId,
          service: order.item.service,
          hours: order.item.hours,
          amount: order.item.amount,
          files: (order.item.files ?? []).map((file): OrderFileDto => ({
            id: file.id,
            name: file.originalName,
            size: file.size,
            type: file.mimeType,
            source: file.source ?? FileSource.CLIENT,
          })),
        }
        : null,
    };
  }

  async checkout(dto: CheckoutDto, userId: string): Promise<{
    orderId: string;
    orderIds: string[];
    status: OrderStatus;
    paymentMethod: CheckoutPaymentMethod;
    paymentUrl?: string;
    params?: Record<string, string | number>;
  }> {
    if (!dto.items?.length) {
      throw new BadRequestException('Order must have at least one item');
    }

    const totalAmount = dto.items.reduce((sum, item) => sum + Number(item.amount), 0);
    if (Math.abs(totalAmount - Number(dto.amount)) > 0.01) {
      throw new BadRequestException('Order total amount does not match item amounts');
    }

    const paymentMethod = dto.paymentMethod ?? CheckoutPaymentMethod.Robokassa;
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const createdOrders: Order[] = [];
      for (const checkoutItem of dto.items) {
        const order = this.orderRepository.create({
          userId,
          amount: checkoutItem.amount,
          deadline: new Date(dto.deadline),
          comments: dto.comments ?? undefined,
          status: OrderStatus.PendingPayment,
        });
        await queryRunner.manager.save(Order, order);

        const item = this.orderItemRepository.create({
          orderId: order.id,
          serviceId: checkoutItem.serviceId,
          hours: checkoutItem.hours ?? null,
          amount: checkoutItem.amount,
        });
        await queryRunner.manager.save(OrderItem, item);
        createdOrders.push(order);
      }

      const orderIds = createdOrders.map((order) => order.id);
      const primaryOrderId = orderIds[0];

      if (paymentMethod === CheckoutPaymentMethod.Balance) {
        await this.balanceService.addToBalance(
          userId,
          -totalAmount,
          BalanceTransactionType.OrderPayment,
          {
            orderId: primaryOrderId,
            description:
              orderIds.length === 1
                ? `Оплата заказа №${primaryOrderId} с внутреннего баланса`
                : `Оплата заказов (${orderIds.length} шт.) с внутреннего баланса`,
          },
          queryRunner.manager,
        );
        await queryRunner.manager.update(
          Order,
          { id: In(orderIds) },
          { status: OrderStatus.Planned },
        );
        await this.cartService.clearAndArchiveActiveCart(userId);
        await queryRunner.commitTransaction();
        return {
          orderId: primaryOrderId,
          orderIds,
          status: OrderStatus.Planned,
          paymentMethod: CheckoutPaymentMethod.Balance,
        };
      }

      const { paymentUrl, params } = await this.paymentService.createWithManager(
        {
          orderId: primaryOrderId,
          orderIds,
          outSum: totalAmount,
          description:
            orderIds.length === 1
              ? `Оплата заказа №${primaryOrderId}`
              : `Оплата заказов (${orderIds.length} шт.)`,
        },
        queryRunner.manager,
      );

      await queryRunner.commitTransaction();
      return {
        orderId: primaryOrderId,
        orderIds,
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
  ): Promise<{ data: OrderDto[]; total: number; offset: number; limit: number }> {
    const { status, offset = 0, limit = 20 } = query;
    const where: { userId: string; status?: OrderStatus } = { userId };
    if (status) where.status = status;

    const [data, total] = await this.orderRepository.findAndCount({
      where,
      relations: ['item', 'item.service', 'item.files'],
      order: { createdAt: 'DESC' },
      skip: offset,
      take: limit,
    });
    return { data: data.map((order) => this.transformOrderFiles(order)), total, offset, limit };
  }

  async findAssignedToExpert(
    expertUserId: string,
    query: GetOrdersQueryDto,
  ): Promise<{ data: OrderDto[]; total: number; offset: number; limit: number }> {
    const { status, offset = 0, limit = 20 } = query;

    const baseQb = this.orderRepository
      .createQueryBuilder('o')
      .innerJoin('o.item', 'item')
      .innerJoin('item.service', 'service')
      .where('service.type = :contractorType', {
        contractorType: ServiceType.Contractor,
      })
      .andWhere('service."userId" = :expertUserId', { expertUserId });

    if (status) {
      baseQb.andWhere('o.status = :status', { status });
    }

    const totalRaw = await baseQb
      .clone()
      .select('COUNT(DISTINCT o.id)', 'total')
      .getRawOne<{ total: string | null }>();
    const total = Number(totalRaw?.total ?? 0);

    const idRows = await baseQb
      .clone()
      .select('o.id', 'id')
      .addSelect('MAX(o."createdAt")', 'createdAt')
      .groupBy('o.id')
      .orderBy('MAX(o."createdAt")', 'DESC')
      .offset(offset)
      .limit(limit)
      .getRawMany<{ id: string; createdAt: string }>();

    const ids = idRows.map((row) => row.id);
    if (!ids.length) {
      return { data: [], total, offset, limit };
    }

    const data = await this.orderRepository.find({
      where: { id: In(ids) },
      relations: ['item', 'item.service', 'item.files'],
      order: { createdAt: 'DESC' },
    });

    return { data: data.map((order) => this.transformOrderFiles(order)), total, offset, limit };
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
      .leftJoin('o.item', 'item')
      .select('o.id', 'id')
      .addSelect('CASE WHEN item.id IS NULL THEN 0 ELSE 1 END', 'itemsCount')
      .addSelect('u.name', 'clientName')
      .addSelect('u."lastName"', 'clientLastName')
      .addSelect('o."createdAt"', 'date')
      .addSelect('o.amount', 'amount')
      .addSelect('o.status', 'status')
      .addSelect('o."contractorChatAccess"', 'contractorChatAccess')
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

  async findOneForAdmin(id: string): Promise<OrderDto> {
    const order = await this.orderRepository.findOne({
      where: { id },
      relations: ['user', 'item', 'item.service', 'item.files'],
    });

    if (!order) {
      throw new NotFoundException(`Order with id ${id} not found`);
    }

    return this.transformOrderFiles(order);
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

  async updateStatusForAdmin(id: string, dto: UpdateOrderStatusDto): Promise<Order> {
    const order = await this.orderRepository.findOne({ where: { id } });
    if (!order) {
      throw new NotFoundException(`Order with id ${id} not found`);
    }

    order.status = dto.status;
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
        (map[OrderStatus.PendingPayment] ?? 0) +
        (map[OrderStatus.Planned] ?? 0) +
        (map[OrderStatus.InProgress] ?? 0),
      completed: map[OrderStatus.Completed] ?? 0,
      cancelled: map[OrderStatus.Cancelled] ?? 0,
    };
  }
}
