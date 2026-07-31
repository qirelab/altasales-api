import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Order } from '../orders/entities/order.entity';
import { OrderStatus } from '../orders/entities/order-status.enum';
import { RopProvisioningService } from './rop-provisioning.service';
import { RopService } from './rop.service';
import { pickHighestTariff, type RopTariffKey } from './rop-tariff.registry';
import { User } from '../users/entities/user.entity';

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

    const projectId = await this.ropProvisioningService.ensureProjectForUser(
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

  private collectTariffsFromOrder(
    order: Order,
  ): Array<RopTariffKey | null | undefined> {
    const item = order.item;
    if (!item) {
      return [];
    }

    // Only the purchased product (service or package) decides the tariff.
    // Nested package services are ignored — set ropTariff on the package itself.
    return [item.service?.ropTariff, item.package?.ropTariff];
  }
}
