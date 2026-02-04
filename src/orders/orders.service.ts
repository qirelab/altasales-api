import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Order } from './entities/order.entity';
import { OrderItem } from './entities/order-item.entity';
import { OrderStatus } from './entities/order-status.enum';
import { CheckoutDto } from './dto/checkout.dto';
import { PaymentService } from '../payment/payment.service';

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

  async checkout(dto: CheckoutDto, userId: number): Promise<{
    orderId: number;
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
}
