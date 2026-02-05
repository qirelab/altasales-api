import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { PaymentService } from '../payment/payment.service';
import { Order } from './entities/order.entity';
import { OrderItem } from './entities/order-item.entity';
import { OrderStatus } from './entities/order-status.enum';
import { CheckoutDto } from './dto/checkout.dto';
import { GetOrdersQueryDto } from './dto/get-orders-query.dto';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';

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

  async updateStatus(
    orderId: string,
    userId: string,
    dto: UpdateOrderStatusDto,
  ): Promise<Order> {
    const order = await this.orderRepository.findOne({
      where: { id: orderId, userId },
      relations: ['items', 'items.service'],
    });
    if (!order) {
      throw new NotFoundException('Order not found');
    }
    order.status = dto.status;
    return this.orderRepository.save(order);
  }
}
