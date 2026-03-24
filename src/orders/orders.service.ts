import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, DataSource, Repository } from 'typeorm';
import { PaymentService } from '../payment/payment.service';
import { User } from '../users/entities/user.entity';
import { Order } from './entities/order.entity';
import { OrderItem } from './entities/order-item.entity';
import { OrderStatus } from './entities/order-status.enum';
import { CheckoutDto } from './dto/checkout.dto';
import { GetAdminOrdersQueryDto } from './dto/get-admin-orders-query.dto';
import { GetOrdersQueryDto } from './dto/get-orders-query.dto';

@Injectable()
export class OrdersService {
  constructor(
    @InjectRepository(Order)
    private readonly orderRepository: Repository<Order>,
    @InjectRepository(OrderItem)
    private readonly orderItemRepository: Repository<OrderItem>,
    private readonly paymentService: PaymentService,
    private readonly dataSource: DataSource,
  ) { }

  async checkout(dto: CheckoutDto, userId: string): Promise<{
    orderId: string;
    paymentUrl: string;
    params: Record<string, string | number>;
  }> {
    if (!dto.items?.length) {
      throw new BadRequestException('Order must have at least one item');
    }

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

      const { paymentUrl, params } = await this.paymentService.createWithManager(
        {
          orderId: order.id,
          outSum: dto.amount,
          description: `Оплата заказа №${order.id}`,
        },
        queryRunner.manager,
      );

      await queryRunner.commitTransaction();
      return { orderId: order.id, paymentUrl, params };
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
    }>;
    total: number;
    offset: number;
    limit: number;
  }> {
    const { offset = 0, limit = 20 } = query;
    const search = query.search?.trim();

    const baseQb = this.orderRepository
      .createQueryBuilder('order')
      .leftJoin(User, 'user', 'user.id = order.userId');

    if (search) {
      baseQb.andWhere(
        new Brackets((qb) => {
          qb
            .where('order.id::text ILIKE :search', { search: `%${search}%` })
            .orWhere('order.status ILIKE :search', { search: `%${search}%` })
            .orWhere('user.name ILIKE :search', { search: `%${search}%` })
            .orWhere('user.lastName ILIKE :search', { search: `%${search}%` })
            .orWhere(`CONCAT(user.name, ' ', user.lastName) ILIKE :search`, {
              search: `%${search}%`,
            });
        }),
      );
    }

    const total = await baseQb.getCount();

    const rows = await baseQb
      .clone()
      .leftJoin('order.items', 'item')
      .select('order.id', 'id')
      .addSelect('COUNT(item.id)', 'itemsCount')
      .addSelect('user.name', 'clientName')
      .addSelect('user.lastName', 'clientLastName')
      .addSelect('order.createdAt', 'date')
      .addSelect('order.amount', 'amount')
      .addSelect('order.status', 'status')
      .groupBy('order.id')
      .addGroupBy('user.name')
      .addGroupBy('user.lastName')
      .orderBy('order.createdAt', 'DESC')
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
