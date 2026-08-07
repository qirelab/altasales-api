import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Order } from '../orders/entities/order.entity';
import { OrderStatus } from '../orders/entities/order-status.enum';
import { User } from '../users/entities/user.entity';
import { RopProvisioningService } from './rop-provisioning.service';
import { RopService } from './rop.service';
import { pickHighestTariff, type RopTariffKey } from './rop-tariff.registry';

const ACTIVE_ORDER_STATUSES = [OrderStatus.Planned, OrderStatus.InProgress];

const ORDER_SUBSCRIPTION_RELATIONS = [
  'item',
  'item.service',
  'item.package',
] as const;

@Injectable()
export class RopSubscriptionService {
  private readonly logger = new Logger(RopSubscriptionService.name);

  constructor(
    private readonly ropService: RopService,
    private readonly ropProvisioningService: RopProvisioningService,
    @InjectRepository(Order)
    private readonly orderRepository: Repository<Order>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  scheduleSyncForUser(userId: string): void {
    void this.syncForUser(userId).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `ROP subscription sync failed for user ${userId}: ${message}`,
      );
    });
  }

  scheduleSyncForOrders(orderIds: string[]): void {
    void this.syncForOrders(orderIds).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `ROP subscription sync failed for orders ${orderIds.join(', ')}: ${message}`,
      );
    });
  }

  async syncForOrders(orderIds: string[]): Promise<void> {
    if (!orderIds.length || !this.ropService.isConfigured()) {
      return;
    }

    const orders = await this.orderRepository.find({
      where: { id: In(orderIds) },
      select: ['userId'],
    });
    const userIds = [...new Set(orders.map((order) => order.userId))];
    for (const userId of userIds) {
      await this.syncForUser(userId);
    }
  }

  async syncForUser(userId: string): Promise<void> {
    if (!this.ropService.isConfigured()) {
      return;
    }

    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user?.email) {
      this.logger.warn(
        `ROP subscription sync skipped: user ${userId} has no email`,
      );
      return;
    }

    const projectId = await this.ropProvisioningService.ensureProvisionedForUser(
      userId,
    );
    if (!projectId) {
      this.logger.warn(
        `ROP subscription sync skipped: no project for user ${userId}`,
      );
      return;
    }

    const tariff = await this.resolveActiveTariffForUser(userId);
    const payload = {
      email: user.email,
      projectId,
    };

    if (tariff) {
      await this.ropService.activateSubscription({ ...payload, tariff });
      this.logger.log(
        `Activated ROP tariff "${tariff}" for user ${userId} (project ${projectId})`,
      );
      return;
    }

    if (!(await this.hasAnyTariffProductOrder(userId))) {
      this.logger.log(
        `ROP subscription sync: no tariff for user ${userId}, skip deactivate`,
      );
      return;
    }

    await this.ropService.deactivateSubscription(payload);
    this.logger.log(
      `Deactivated ROP subscription for user ${userId} (project ${projectId})`,
    );
  }

  private async resolveActiveTariffForUser(
    userId: string,
  ): Promise<RopTariffKey | null> {
    const orders = await this.orderRepository.find({
      where: {
        userId,
        status: In(ACTIVE_ORDER_STATUSES),
      },
      relations: [...ORDER_SUBSCRIPTION_RELATIONS],
    });

    const tariffs: Array<RopTariffKey | null | undefined> = [];
    for (const order of orders) {
      tariffs.push(...this.collectTariffsFromOrder(order));
    }

    return pickHighestTariff(tariffs);
  }

  private async hasAnyTariffProductOrder(userId: string): Promise<boolean> {
    const orders = await this.orderRepository.find({
      where: { userId },
      relations: [...ORDER_SUBSCRIPTION_RELATIONS],
    });

    return orders.some((order) =>
      this.collectTariffsFromOrder(order).some((tariff) => Boolean(tariff)),
    );
  }

  private collectTariffsFromOrder(
    order: Order,
  ): Array<RopTariffKey | null | undefined> {
    const item = order.item;
    if (!item) {
      return [];
    }

    return [item.service?.ropTariff, item.package?.ropTariff];
  }
}
