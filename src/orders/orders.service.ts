import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, DataSource, EntityManager, In, Repository } from 'typeorm';
import { ServicePackage } from '../packages/entities/package.entity';
import { PaymentService } from '../payment/payment.service';
import { Service } from '../services/entities/service.entity';
import { User } from '../users/entities/user.entity';
import { ServiceType } from '../services/entities/service-type.enum';
import { FileSource } from '../files/entities/file.entity';
import { Order } from './entities/order.entity';
import { OrderItem } from './entities/order-item.entity';
import { OrderItemSubItem } from './entities/order-item-sub-item.entity';
import { OrderStatus } from './entities/order-status.enum';
import { CheckoutDto } from './dto/checkout.dto';
import { CheckoutPaymentMethod } from './dto/checkout-payment-method.enum';
import { GetAdminOrdersQueryDto } from './dto/get-admin-orders-query.dto';
import { GetOrdersQueryDto } from './dto/get-orders-query.dto';
import { UpdateContractorChatAccessDto } from './dto/update-contractor-chat-access.dto';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';
import { BalanceService } from '../balance-transactions/balance.service';
import { CartService } from '../cart/cart.service';
import { Recommendation } from '../recommendations/entities/recommendation.entity';
import { RecommendationStatus } from '../recommendations/entities/recommendation-status.enum';

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
  serviceId: string | null;
  service: OrderItem['service'] | null;
  packageId: string | null;
  package: OrderItem['package'] | null;
  hours: number | null;
  amount: number;
  status: OrderStatus;
  subItems: Array<{
    id: string;
    serviceId: string;
    service: Service;
    status: OrderStatus;
    files: OrderFileDto[];
  }>;
  files: OrderFileDto[];
}

export interface OrderDto {
  id: string;
  userId: string;
  createdAt: Date;
  amount: number;
  status: OrderStatus;
  deadline: Date | null;
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
    @InjectRepository(OrderItemSubItem)
    private readonly orderItemSubItemRepository: Repository<OrderItemSubItem>,
    @InjectRepository(Service)
    private readonly serviceRepository: Repository<Service>,
    @InjectRepository(ServicePackage)
    private readonly packageRepository: Repository<ServicePackage>,
    @InjectRepository(Recommendation)
    private readonly recommendationRepository: Repository<Recommendation>,
    private readonly paymentService: PaymentService,
    private readonly dataSource: DataSource,
    private readonly balanceService: BalanceService,
    private readonly cartService: CartService,
  ) { }

  private mapOrderStatusToRecommendationStatus(status: OrderStatus): RecommendationStatus {
    switch (status) {
      case OrderStatus.InProgress:
        return RecommendationStatus.InProgress;
      case OrderStatus.Completed:
        return RecommendationStatus.Completed;
      case OrderStatus.Cancelled:
        return RecommendationStatus.Recommended;
      case OrderStatus.PendingPayment:
      case OrderStatus.Planned:
      default:
        return RecommendationStatus.Planned;
    }
  }

  private async syncRecommendationForOrder(
    order: Pick<Order, 'id' | 'userId' | 'status'>,
    target: { serviceId?: string | null; packageId?: string | null },
    manager?: EntityManager,
  ): Promise<void> {
    const recommendationRepo = manager
      ? manager.getRepository(Recommendation)
      : this.recommendationRepository;
    const hasService = Boolean(target.serviceId);
    const hasPackage = Boolean(target.packageId);
    if (hasService === hasPackage) {
      return;
    }

    const recommendation = await recommendationRepo.findOne({
      where: hasService
        ? { userId: order.userId, serviceId: target.serviceId! }
        : { userId: order.userId, packageId: target.packageId! },
    });

    if (!recommendation) {
      return;
    }

    recommendation.status = this.mapOrderStatusToRecommendationStatus(order.status);
    recommendation.orderId = order.status === OrderStatus.Cancelled ? null : order.id;
    await recommendationRepo.save(recommendation);
  }

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
          packageId: order.item.packageId,
          package: order.item.package,
          hours: order.item.hours,
          amount: order.item.amount,
          status: order.item.status,
          subItems: (order.item.subItems ?? []).map((subItem) => ({
            id: subItem.id,
            serviceId: subItem.serviceId,
            service: subItem.service,
            status: subItem.status,
            files: (subItem.files ?? []).map((file): OrderFileDto => ({
              id: file.id,
              name: file.originalName,
              size: file.size,
              type: file.mimeType,
              source: file.source ?? FileSource.CLIENT,
            })),
          })),
          files: (order.item.files ?? [])
            .filter((file) => file.orderItemSubItemId === null)
            .map((file): OrderFileDto => ({
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

  private normalizeStatusForPackageAggregation(status: OrderStatus): OrderStatus {
    return status === OrderStatus.PendingPayment ? OrderStatus.Planned : status;
  }

  private calculatePackageItemStatusFromSubItems(subItems: OrderItemSubItem[]): OrderStatus {
    const normalized = subItems.map((subItem) =>
      this.normalizeStatusForPackageAggregation(subItem.status),
    );

    if (normalized.every((status) => status === OrderStatus.Cancelled)) {
      return OrderStatus.Cancelled;
    }

    const nonCancelled = normalized.filter((status) => status !== OrderStatus.Cancelled);
    if (nonCancelled.length === 0) {
      return OrderStatus.Cancelled;
    }
    if (nonCancelled.every((status) => status === OrderStatus.Completed)) {
      return OrderStatus.Completed;
    }
    if (nonCancelled.some((status) => status === OrderStatus.InProgress)) {
      return OrderStatus.InProgress;
    }

    const hasCompleted = nonCancelled.some((status) => status === OrderStatus.Completed);
    const hasPlanned = nonCancelled.some((status) => status === OrderStatus.Planned);
    if (hasCompleted && hasPlanned) {
      return OrderStatus.InProgress;
    }
    if (nonCancelled.every((status) => status === OrderStatus.Planned)) {
      return OrderStatus.Planned;
    }

    return OrderStatus.InProgress;
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

    const paymentMethod = dto.paymentMethod ?? CheckoutPaymentMethod.Robokassa;
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const createdOrders: Order[] = [];
      let totalAmount = 0;
      for (const checkoutItem of dto.items) {
        const hasService = Boolean(checkoutItem.serviceId);
        const hasPackage = Boolean(checkoutItem.packageId);
        if (hasService === hasPackage) {
          throw new BadRequestException('Exactly one of serviceId or packageId is required for each item');
        }

        let resolvedAmount = Number(checkoutItem.amount);
        if (checkoutItem.serviceId) {
          const service = await this.serviceRepository.findOne({
            where: { id: checkoutItem.serviceId },
          });
          if (!service) {
            throw new NotFoundException(`Service with id ${checkoutItem.serviceId} not found`);
          }
        }
        if (checkoutItem.packageId) {
          const servicePackage = await this.packageRepository.findOne({
            where: { id: checkoutItem.packageId },
          });
          if (!servicePackage) {
            throw new NotFoundException(`Package with id ${checkoutItem.packageId} not found`);
          }
          resolvedAmount = Number(servicePackage.price);
        }

        const order = this.orderRepository.create({
          userId,
          amount: resolvedAmount,
          comments: dto.comments ?? undefined,
          status: OrderStatus.PendingPayment,
        });
        await queryRunner.manager.save(Order, order);

        const item = this.orderItemRepository.create({
          orderId: order.id,
          serviceId: checkoutItem.serviceId ?? null,
          packageId: checkoutItem.packageId ?? null,
          hours: checkoutItem.hours ?? null,
          amount: resolvedAmount,
          status: OrderStatus.PendingPayment,
        });
        await queryRunner.manager.save(OrderItem, item);
        if (checkoutItem.packageId) {
          const servicePackage = await this.packageRepository.findOne({
            where: { id: checkoutItem.packageId },
            relations: ['services'],
          });
          const packageServices = servicePackage?.services ?? [];
          const subItems = packageServices.map((service) => this.orderItemSubItemRepository.create({
            orderItemId: item.id,
            serviceId: service.id,
            status: OrderStatus.PendingPayment,
          }));
          if (subItems.length > 0) {
            await queryRunner.manager.save(OrderItemSubItem, subItems);
          }
        }
        if (checkoutItem.serviceId || checkoutItem.packageId) {
          await this.syncRecommendationForOrder(order, {
            serviceId: checkoutItem.serviceId ?? null,
            packageId: checkoutItem.packageId ?? null,
          }, queryRunner.manager);
        }
        totalAmount += resolvedAmount;
        createdOrders.push(order);
      }

      if (Math.abs(totalAmount - Number(dto.amount)) > 0.01) {
        throw new BadRequestException('Order total amount does not match item amounts');
      }

      const orderIds = createdOrders.map((order) => order.id);
      const primaryOrderId = orderIds[0];
      const balancePaymentDescription =
        orderIds.length === 1
          ? `Оплата заказа №${primaryOrderId} с внутреннего баланса`
          : `Оплата заказов (${orderIds.length} шт.) с внутреннего баланса`;

      if (paymentMethod === CheckoutPaymentMethod.Balance) {
        await this.balanceService.debitForOrderPayment(
          userId,
          totalAmount,
          {
            orderId: primaryOrderId,
            description: balancePaymentDescription,
          },
          queryRunner.manager,
        );
        await queryRunner.manager.update(
          Order,
          { id: In(orderIds) },
          { status: OrderStatus.Planned },
        );
        await queryRunner.manager.update(
          OrderItem,
          { orderId: In(orderIds) },
          { status: OrderStatus.Planned },
        );
        const itemIds = await queryRunner.manager
          .getRepository(OrderItem)
          .createQueryBuilder('item')
          .select('item.id', 'id')
          .where('item."orderId" IN (:...orderIds)', { orderIds })
          .getRawMany()
          .then((rows) => rows.map((row: { id: string }) => row.id));
        if (itemIds.length > 0) {
          await queryRunner.manager.update(
            OrderItemSubItem,
            { orderItemId: In(itemIds) },
            { status: OrderStatus.Planned },
          );
        }
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
      relations: [
        'item',
        'item.service',
        'item.package',
        'item.package.services',
        'item.subItems',
        'item.subItems.service',
        'item.subItems.files',
        'item.files',
      ],
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
      relations: [
        'item',
        'item.service',
        'item.package',
        'item.package.services',
        'item.subItems',
        'item.subItems.service',
        'item.subItems.files',
        'item.files',
      ],
      order: { createdAt: 'DESC' },
    });

    return { data: data.map((order) => this.transformOrderFiles(order)), total, offset, limit };
  }

  async findAllForAdmin(query: GetAdminOrdersQueryDto): Promise<{
    data: Array<{
      id: string;
      itemsCount: number;
      typeLabel: 'Услуга' | 'Документ' | 'Подрядчик' | 'Пакет услуг';
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
      .leftJoin('item.service', 'svc')
      .select('o.id', 'id')
      .addSelect('CASE WHEN item.id IS NULL THEN 0 ELSE 1 END', 'itemsCount')
      .addSelect(
        `CASE
           WHEN item.id IS NULL THEN 'Услуга'
           WHEN item."packageId" IS NOT NULL THEN 'Пакет услуг'
           WHEN svc.type IN ('Услуга', 'Документ', 'Подрядчик') THEN svc.type
           ELSE 'Услуга'
         END`,
        'typeLabel',
      )
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
        typeLabel: 'Услуга' | 'Документ' | 'Подрядчик' | 'Пакет услуг';
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
        typeLabel: row.typeLabel,
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
      relations: [
        'user',
        'item',
        'item.service',
        'item.package',
        'item.package.services',
        'item.subItems',
        'item.subItems.service',
        'item.subItems.files',
        'item.files',
      ],
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
    const order = await this.orderRepository.findOne({
      where: { id },
      relations: ['item'],
    });
    if (!order) {
      throw new NotFoundException(`Order with id ${id} not found`);
    }
    if (order.item?.packageId) {
      throw new BadRequestException(
        'Статус пакета вычисляется по статусам услуг внутри — обновите статусы услуг',
      );
    }

    order.status = dto.status;
    const savedOrder = await this.orderRepository.save(order);
    if (order.item?.serviceId) {
      await this.syncRecommendationForOrder(savedOrder, { serviceId: order.item.serviceId });
    } else if (order.item?.packageId) {
      await this.syncRecommendationForOrder(savedOrder, { packageId: order.item.packageId });
    }
    return savedOrder;
  }

  async updateItemStatusForAdmin(itemId: string, status: OrderStatus): Promise<OrderItem> {
    const item = await this.orderItemRepository.findOne({
      where: { id: itemId },
      relations: ['order', 'subItems'],
    });
    if (!item) {
      throw new NotFoundException(`Order item with id ${itemId} not found`);
    }
    if (item.packageId) {
      throw new BadRequestException('Для пакета используйте смену статуса по каждой услуге пакета');
    }

    item.status = status;
    const savedItem = await this.orderItemRepository.save(item);

    if (savedItem.serviceId) {
      await this.syncRecommendationForOrder(savedItem.order, { serviceId: savedItem.serviceId });
    }

    return savedItem;
  }

  async updateSubItemStatus(
    itemId: string,
    subItemId: string,
    status: OrderStatus,
  ): Promise<{ subItem: OrderItemSubItem; itemStatus: OrderStatus }> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const itemRepo = queryRunner.manager.getRepository(OrderItem);
      const subItemRepo = queryRunner.manager.getRepository(OrderItemSubItem);

      const item = await itemRepo.findOne({
        where: { id: itemId },
        relations: ['order', 'subItems', 'subItems.service'],
      });
      if (!item) {
        throw new NotFoundException(`Order item with id ${itemId} not found`);
      }
      if (!item.packageId) {
        throw new BadRequestException('Эта позиция заказа не является пакетом');
      }
      if (!item.subItems.length) {
        throw new BadRequestException('В пакете нет услуг');
      }

      const subItem = item.subItems.find((entry) => entry.id === subItemId);
      if (!subItem) {
        throw new NotFoundException(`Order sub-item with id ${subItemId} not found`);
      }

      subItem.status = status;
      await subItemRepo.save(subItem);

      const recalculatedStatus = this.calculatePackageItemStatusFromSubItems(item.subItems);
      const prevStatus = item.status;
      item.status = recalculatedStatus;
      const savedItem = await itemRepo.save(item);

      const orderRepo = queryRunner.manager.getRepository(Order);
      const parentOrder = await orderRepo.findOne({ where: { id: savedItem.orderId } });
      if (parentOrder && parentOrder.status !== recalculatedStatus) {
        parentOrder.status = recalculatedStatus;
        await orderRepo.save(parentOrder);
      }

      if (prevStatus !== recalculatedStatus) {
        const recommendation = await queryRunner.manager.getRepository(Recommendation).findOne({
          where: { orderId: savedItem.orderId },
        });
        if (recommendation) {
          recommendation.status = this.mapOrderStatusToRecommendationStatus(recalculatedStatus);
          recommendation.orderId = recalculatedStatus === OrderStatus.Cancelled ? null : savedItem.orderId;
          await queryRunner.manager.getRepository(Recommendation).save(recommendation);
        }
      }

      await queryRunner.commitTransaction();
      return { subItem, itemStatus: recalculatedStatus };
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
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
