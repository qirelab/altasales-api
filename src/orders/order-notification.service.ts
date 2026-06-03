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

export const ORDER_PAID_CLIENT_MESSAGE =
  'Спасибо за заказ! Наш менеджер свяжется с вами в течение 24 часов.';

export interface OrderPaidSocketPayload {
  primaryOrderId: string;
  orderIds: string[];
  userId: string;
  clientName: string;
  amount: number;
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
    private readonly chatService: ChatService,
    private readonly mailService: MailService,
    private readonly websocketGateway: WebSocketGatewayService,
    private readonly configService: ConfigService,
  ) {}

  async notifyOrderPaid(orderIds: string[]): Promise<void> {
    if (!orderIds.length) return;

    const orders = await this.orderRepository.find({
      where: { id: In(orderIds) },
      relations: ['user'],
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

    await this.sendClientChatMessage(client.id);
    await this.notifyAdmins(
      orders[0],
      orders.map((order) => order.id),
      client,
      totalAmount,
    );
  }

  private async sendClientChatMessage(clientId: string): Promise<void> {
    const admin = await this.userRepository.findOne({
      where: { role: UserRole.ADMIN },
      order: { createdAt: 'ASC' },
    });

    if (!admin) {
      this.logger.warn(
        'No admin user found — skipping client chat notification',
      );
      return;
    }

    try {
      await this.chatService.sendMessage(admin.id, {
        recipientId: clientId,
        text: ORDER_PAID_CLIENT_MESSAGE,
      });
    } catch (error) {
      this.logger.error(
        `Failed to send order-paid chat message to client ${clientId}: ` +
          `${(error as Error).message}`,
        (error as Error).stack,
      );
    }
  }

  private async notifyAdmins(
    order: Order,
    orderIds: string[],
    client: User,
    amount: number,
  ): Promise<void> {
    const fullName = [client.name, client.lastName].filter(Boolean).join(' ');
    const clientName = fullName || client.email;
    const payload: OrderPaidSocketPayload = {
      primaryOrderId: order.id,
      orderIds,
      userId: client.id,
      clientName,
      amount,
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
    const adminOrderUrl = clientUrl
      ? `${clientUrl}/admin/orders/${order.id}`
      : null;

    await this.mailService.notifyAdminsAboutPaidOrder({
      orderId: order.id,
      clientName,
      amount,
      adminOrderUrl,
    });

    this.logger.log(`Order-paid notification dispatched for order ${order.id}`);
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
