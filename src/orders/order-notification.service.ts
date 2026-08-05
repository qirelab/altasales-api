import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { ChatService } from '../chat/chat.service';
import { MailService } from '../mail/mail.service';
import { User } from '../users/entities/user.entity';
import { UserRole } from '../users/entities/user-role.enum';
import { WebSocketGatewayService } from '../websocket/websocket.gateway';
import { Order } from './entities/order.entity';
import { OrderStatus } from './entities/order-status.enum';

export interface OrderPaidItem {
  orderId: string;
  name: string;
  type: 'Услуга' | 'Документ' | 'Подрядчик' | 'Пакет' | 'Услуги эксперта';
  amount: number;
}

export interface OrderPaidSocketPayload {
  primaryOrderId: string;
  orderIds: string[];
  userId: string;
  clientName: string;
  amount: number;
  items: OrderPaidItem[];
  createdAt: string;
}

@Injectable()
export class OrderNotificationService {
  private readonly logger = new Logger(OrderNotificationService.name);

  constructor(
    @InjectRepository(Order)
    private readonly orderRepository: Repository<Order>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly mailService: MailService,
    private readonly websocketGateway: WebSocketGatewayService,
    private readonly configService: ConfigService,
    private readonly chatService: ChatService,
  ) {}

  async notifyOrderPaid(orderIds: string[]): Promise<void> {
    this.logger.log(
      `notifyOrderPaid invoked for orders: ${orderIds.join(', ')}`,
    );
    if (!orderIds.length) return;

    try {
      await this.chatService.ensureExpertSessionsForPaidOrders(orderIds);
    } catch (error) {
      this.logger.error(
        `ensureExpertSessionsForPaidOrders failed for ${orderIds.join(', ')}: ${
          error instanceof Error ? error.message : String(error)
        }`,
        error instanceof Error ? error.stack : undefined,
      );
    }

    const orders = await this.orderRepository.find({
      where: { id: In(orderIds) },
      relations: [
        'user',
        'item',
        'item.service',
        'item.package',
        'item.executor',
      ],
    });

    if (!orders.length) {
      this.logger.warn(
        `notifyOrderPaid: no orders found for ids ${orderIds.join(', ')}`,
      );
      return;
    }

    const userIds = Array.from(new Set(orders.map((order) => order.userId)));
    if (userIds.length > 1) {
      this.logger.error(
        `notifyOrderPaid: orders span multiple users (${userIds.join(', ')}); skipping notifications`,
      );
      return;
    }

    const client = orders[0].user;
    if (!client) {
      this.logger.error(
        `notifyOrderPaid: client user not loaded for order ${orders[0].id}`,
      );
      return;
    }

    const totalAmount = orders.reduce(
      (sum, order) => sum + Number(order.amount),
      0,
    );

    const items: OrderPaidItem[] = orders.map((order) =>
      this.buildOrderPaidItem(order),
    );

    await this.sendClientEmail(client, items, totalAmount);
    await this.notifyAdmins(
      orders[0],
      orders.map((order) => order.id),
      client,
      totalAmount,
      items,
    );
  }

  private buildOrderPaidItem(order: Order): OrderPaidItem {
    const orderItem = order.item;
    const isPackage = Boolean(orderItem?.package);
    const isExpert = Boolean(orderItem?.expertPositionId);

    if (isExpert) {
      const executor = orderItem?.executor;
      const fullName = executor
        ? [executor.name, executor.lastName].filter(Boolean).join(' ').trim()
        : '';
      return {
        orderId: order.id,
        name: fullName ? `Услуги ${fullName}` : 'Услуги эксперта',
        type: 'Услуги эксперта',
        amount: Number(order.amount),
      };
    }

    if (isPackage) {
      return {
        orderId: order.id,
        name: orderItem?.package?.name ?? '—',
        type: 'Пакет',
        amount: Number(order.amount),
      };
    }

    return {
      orderId: order.id,
      name: orderItem?.service?.name ?? '—',
      type: (orderItem?.service?.type as OrderPaidItem['type']) ?? 'Услуга',
      amount: Number(order.amount),
    };
  }

  private async sendClientEmail(
    client: User,
    items: OrderPaidItem[],
    totalAmount: number,
  ): Promise<void> {
    if (!client.email) {
      this.logger.warn(
        `notifyOrderPaid: client ${client.id} has no email — skipping client email`,
      );
      return;
    }

    const fullName = [client.name, client.lastName].filter(Boolean).join(' ');
    const clientName = fullName || client.email;

    this.logger.log(`Sending order-paid email to client ${client.email}`);

    await this.mailService.sendOrderPaidClientEmail({
      email: client.email,
      clientName,
      items,
      amount: totalAmount,
    });
  }

  private async notifyAdmins(
    order: Order,
    orderIds: string[],
    client: User,
    amount: number,
    items: OrderPaidItem[],
  ): Promise<void> {
    const fullName = [client.name, client.lastName].filter(Boolean).join(' ');
    const clientName = fullName || client.email;
    const payload: OrderPaidSocketPayload = {
      primaryOrderId: order.id,
      orderIds,
      userId: client.id,
      clientName,
      amount,
      items,
      createdAt: order.createdAt.toISOString(),
    };

    const admins = await this.userRepository.find({
      where: { role: UserRole.ADMIN },
      select: ['id'],
    });
    for (const admin of admins) {
      this.websocketGateway.emitToUser(admin.id, 'order:new', payload);
    }

    const clientUrl = this.configService
      .get<string>('CLIENT_URI', '')
      .split(',')[0]
      .trim();
    const adminOrdersUrl = clientUrl ? `${clientUrl}/admin/orders` : null;

    await this.mailService.notifyAdminsAboutPaidOrder({
      orderId: order.id,
      clientName,
      amount,
      items,
      adminOrdersUrl,
    });

    this.logger.log(
      `Order-paid notification dispatched for order ${order.id} (${items.length} positions)`,
    );
  }

  async markAdminSeen(userId: string): Promise<{
    adminOrderNotificationsSeenAt: Date;
  }> {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException(`User ${userId} not found`);
    }
    user.adminOrderNotificationsSeenAt = new Date();
    const saved = await this.userRepository.save(user);
    return {
      adminOrderNotificationsSeenAt: saved.adminOrderNotificationsSeenAt!,
    };
  }

  async getAdminUnseen(userId: string): Promise<{
    unseenCount: number;
    hasUnseen: boolean;
  }> {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException(`User ${userId} not found`);
    }
    const qb = this.orderRepository
      .createQueryBuilder('o')
      .where('o.status IN (:...statuses)', {
        statuses: [
          OrderStatus.Planned,
          OrderStatus.InProgress,
          OrderStatus.Completed,
        ],
      });
    if (user.adminOrderNotificationsSeenAt) {
      qb.andWhere('o."updatedAt" > :seenAt', {
        seenAt: user.adminOrderNotificationsSeenAt,
      });
    }
    const unseenCount = await qb.getCount();
    return { unseenCount, hasUnseen: unseenCount > 0 };
  }
}
