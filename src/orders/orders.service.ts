import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  Brackets,
  DataSource,
  EntityManager,
  In,
  IsNull,
  Repository,
} from 'typeorm';
import { ExpertsService } from '../experts/experts.service';
import { ExpertPositionOffering } from '../experts/entities/expert-position-offering.entity';
import { ExpertProfile } from '../experts/entities/expert-profile.entity';
import { ServicePackage } from '../packages/entities/package.entity';
import { PaymentService } from '../payment/payment.service';
import { Service } from '../services/entities/service.entity';
import { User } from '../users/entities/user.entity';
import { ServiceType } from '../services/entities/service-type.enum';
import { FileSource } from '../files/entities/file.entity';
import { BalanceService } from '../balance-transactions/balance.service';
import { CartService } from '../cart/cart.service';
import { Recommendation } from '../recommendations/entities/recommendation.entity';
import { RecommendationStatus } from '../recommendations/entities/recommendation-status.enum';
import { RecommendationUserLockService } from '../recommendations/recommendation-user-lock.service';
import { ChatService } from '../chat/chat.service';
import { Order } from './entities/order.entity';
import { OrderItem } from './entities/order-item.entity';
import { OrderItemSubItem } from './entities/order-item-sub-item.entity';
import { OrderStatus } from './entities/order-status.enum';
import { OrderNotificationService } from './order-notification.service';
import { CheckoutDto } from './dto/checkout.dto';
import { CheckoutPaymentMethod } from './dto/checkout-payment-method.enum';
import { AdminOrderListItemDto } from './dto/admin-order-list-item.dto';
import { GetAdminOrdersQueryDto } from './dto/get-admin-orders-query.dto';
import { GetOrdersQueryDto } from './dto/get-orders-query.dto';
import { UpdateContractorChatAccessDto } from './dto/update-contractor-chat-access.dto';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';

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
  expertPositionId: string | null;
  expertPosition: OrderItem['expertPosition'] | null;
  executorUserId: string | null;
  executor: OrderItem['executor'] | null;
  hours: number | null;
  amount: number;
  status: OrderStatus;
  subItems: Array<{
    id: string;
    serviceId: string | null;
    service: Service | null;
    expertPositionOfferingId: string | null;
    expertPositionOffering: OrderItemSubItem['expertPositionOffering'] | null;
    unitPrice: number | null;
    status: OrderStatus;
    files: OrderFileDto[];
  }>;
  files: OrderFileDto[];
}

const ORDER_DETAIL_RELATIONS = [
  'item',
  'item.service',
  'item.package',
  'item.package.services',
  'item.expertPosition',
  'item.executor',
  'item.subItems',
  'item.subItems.service',
  'item.subItems.expertPositionOffering',
  'item.subItems.files',
  'item.files',
] as const;

export interface OrderDto {
  id: string;
  userId: string;
  createdAt: Date;
  amount: number;
  status: OrderStatus;
  deadline: Date | null;
  comments?: string | null;
  contractorChatAccess: boolean;
  name: string;
  item: OrderItemDto | null;
  user?: User;
}

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

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
    @InjectRepository(ExpertProfile)
    private readonly expertProfileRepository: Repository<ExpertProfile>,
    @InjectRepository(ExpertPositionOffering)
    private readonly expertOfferingRepository: Repository<ExpertPositionOffering>,
    private readonly expertsService: ExpertsService,
    private readonly paymentService: PaymentService,
    private readonly dataSource: DataSource,
    private readonly balanceService: BalanceService,
    private readonly cartService: CartService,
    private readonly orderNotificationService: OrderNotificationService,
    private readonly chatService: ChatService,
    private readonly recommendationUserLockService: RecommendationUserLockService,
  ) {}

  private mapOrderStatusToRecommendationStatus(
    status: OrderStatus,
  ): RecommendationStatus {
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
    const sync = async (lockedManager: EntityManager): Promise<void> => {
      const recommendationRepo = lockedManager.getRepository(Recommendation);
      const hasService = Boolean(target.serviceId);
      const hasPackage = Boolean(target.packageId);
      if (hasService === hasPackage) return;

      const recommendation = await recommendationRepo.findOne({
        where: hasService
          ? { userId: order.userId, serviceId: target.serviceId! }
          : { userId: order.userId, packageId: target.packageId! },
      });
      if (!recommendation) return;

      recommendation.status = this.mapOrderStatusToRecommendationStatus(
        order.status,
      );
      recommendation.orderId =
        order.status === OrderStatus.Cancelled ? null : order.id;
      await recommendationRepo.save(recommendation);
    };

    if (manager) {
      await this.recommendationUserLockService.lockUser(order.userId, manager);
      await sync(manager);
      return;
    }

    await this.recommendationUserLockService.withUserLock(order.userId, sync);
  }

  private resolveOrderProductName(order: Order): string {
    const item = order.item;
    if (!item) {
      return '';
    }
    if (item.expertPositionId) {
      const offeringNames = (item.subItems ?? [])
        .map((sub) => sub.expertPositionOffering?.name?.trim())
        .filter((name): name is string => Boolean(name));
      if (offeringNames.length > 0) {
        return offeringNames.join(', ');
      }
      return 'Услуга эксперта';
    }
    return item.package?.name ?? item.service?.name ?? '';
  }

  private assertOrderNotPendingPaymentForManualStatusChange(
    order: Pick<Order, 'status'>,
  ): void {
    if (order.status === OrderStatus.PendingPayment) {
      throw new BadRequestException(
        'Статус «Ожидает оплаты» нельзя изменить вручную — он меняется автоматически после оплаты',
      );
    }
  }

  private async hydrateDeletedExpertOfferings(
    subItems: OrderItemSubItem[],
  ): Promise<void> {
    const offeringIds = [
      ...new Set(
        subItems
          .filter(
            (subItem) =>
              subItem.expertPositionOfferingId &&
              !subItem.expertPositionOffering,
          )
          .map((subItem) => subItem.expertPositionOfferingId!),
      ),
    ];
    if (!offeringIds.length) {
      return;
    }

    const offerings = await this.expertOfferingRepository.find({
      where: { id: In(offeringIds) },
      withDeleted: true,
    });
    const offeringById = new Map(
      offerings.map((offering) => [offering.id, offering]),
    );

    for (const subItem of subItems) {
      if (subItem.expertPositionOfferingId && !subItem.expertPositionOffering) {
        const offering = offeringById.get(subItem.expertPositionOfferingId);
        if (offering) {
          subItem.expertPositionOffering = offering;
        }
      }
    }
  }

  private async hydrateDeletedExpertOfferingsForOrders(
    orders: Order[],
  ): Promise<void> {
    const subItems = orders.flatMap((order) => order.item?.subItems ?? []);
    await this.hydrateDeletedExpertOfferings(subItems);
  }

  private async attachExecutorImagesToOrders(orders: Order[]): Promise<void> {
    const executorUserIds = [
      ...new Set(
        orders
          .map(
            (order) =>
              order.item?.executorUserId ?? order.item?.executor?.id ?? null,
          )
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    if (!executorUserIds.length) return;

    const profiles = await this.expertProfileRepository.find({
      where: { userId: In(executorUserIds) },
    });
    const imageByUserId = new Map(
      profiles
        .filter((profile) => Boolean(profile.image))
        .map((profile) => [profile.userId, profile.image as string]),
    );

    const fallbackRows = await this.serviceRepository
      .createQueryBuilder('service')
      .select('service."userId"', 'userId')
      .addSelect('MAX(service.image)', 'image')
      .where('service."userId" IN (:...executorUserIds)', { executorUserIds })
      .andWhere('service.type = :contractorType', {
        contractorType: ServiceType.Contractor,
      })
      .andWhere('service."deletedAt" IS NULL')
      .andWhere('service.image IS NOT NULL')
      .groupBy('service."userId"')
      .getRawMany<{ userId: string; image: string | null }>();

    fallbackRows.forEach((row) => {
      if (!imageByUserId.has(row.userId) && row.image) {
        imageByUserId.set(row.userId, row.image);
      }
    });

    orders.forEach((order) => {
      const executor = order.item?.executor as
        | (OrderItem['executor'] & { image?: string | null })
        | undefined;
      const executorUserId = order.item?.executorUserId ?? executor?.id;
      if (!executor || !executorUserId) return;
      executor.image = imageByUserId.get(executorUserId) ?? null;
    });
  }

  private transformOrderFiles(order: Order): OrderDto {
    let item: OrderDto['item'] = null;
    if (order.item) {
      const orderItem = order.item;
      item = {
        id: orderItem.id,
        orderId: orderItem.orderId,
        serviceId: orderItem.serviceId,
        service: orderItem.service,
        packageId: orderItem.packageId,
        package: orderItem.package,
        expertPositionId: orderItem.expertPositionId,
        expertPosition: orderItem.expertPosition,
        executorUserId: orderItem.executorUserId,
        executor: orderItem.executor,
        hours: orderItem.hours,
        amount: orderItem.amount,
        status: orderItem.status,
        subItems: (orderItem.subItems ?? []).map((subItem) => ({
          id: subItem.id,
          serviceId: subItem.serviceId,
          service: subItem.service,
          expertPositionOfferingId: subItem.expertPositionOfferingId,
          expertPositionOffering: subItem.expertPositionOffering,
          unitPrice:
            subItem.unitPrice != null ? Number(subItem.unitPrice) : null,
          status: subItem.status,
          files: (subItem.files ?? []).map(
            (file): OrderFileDto => ({
              id: file.id,
              name: file.originalName,
              size: file.size,
              type: file.mimeType,
              source: file.source ?? FileSource.CLIENT,
            }),
          ),
        })),
        files: (orderItem.files ?? [])
          .filter((file) => file.orderItemSubItemId === null)
          .map(
            (file): OrderFileDto => ({
              id: file.id,
              name: file.originalName,
              size: file.size,
              type: file.mimeType,
              source: file.source ?? FileSource.CLIENT,
            }),
          ),
      };
    }

    return {
      id: order.id,
      userId: order.userId,
      createdAt: order.createdAt,
      amount: order.amount,
      status: order.status,
      deadline: order.deadline,
      comments: order.comments,
      contractorChatAccess: order.contractorChatAccess,
      name: this.resolveOrderProductName(order),
      user: order.user,
      item,
    };
  }

  private normalizeStatusForPackageAggregation(
    status: OrderStatus,
  ): OrderStatus {
    return status === OrderStatus.PendingPayment ? OrderStatus.Planned : status;
  }

  private calculatePackageItemStatusFromSubItems(
    subItems: OrderItemSubItem[],
  ): OrderStatus {
    const normalized = subItems.map((subItem) =>
      this.normalizeStatusForPackageAggregation(subItem.status),
    );

    if (normalized.every((status) => status === OrderStatus.Cancelled)) {
      return OrderStatus.Cancelled;
    }

    const nonCancelled = normalized.filter(
      (status) => status !== OrderStatus.Cancelled,
    );
    if (nonCancelled.length === 0) {
      return OrderStatus.Cancelled;
    }
    if (nonCancelled.every((status) => status === OrderStatus.Completed)) {
      return OrderStatus.Completed;
    }
    if (nonCancelled.some((status) => status === OrderStatus.InProgress)) {
      return OrderStatus.InProgress;
    }

    const hasCompleted = nonCancelled.some(
      (status) => status === OrderStatus.Completed,
    );
    const hasPlanned = nonCancelled.some(
      (status) => status === OrderStatus.Planned,
    );
    if (hasCompleted && hasPlanned) {
      return OrderStatus.InProgress;
    }
    if (nonCancelled.every((status) => status === OrderStatus.Planned)) {
      return OrderStatus.Planned;
    }

    return OrderStatus.InProgress;
  }

  async checkout(
    dto: CheckoutDto,
    userId: string,
  ): Promise<{
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
      await this.recommendationUserLockService.lockUser(
        userId,
        queryRunner.manager,
      );
      const createdOrders: Order[] = [];
      let totalAmount = 0;
      let giftEligibleAmount = 0;
      for (const checkoutItem of dto.items) {
        const productRefs = [
          checkoutItem.serviceId,
          checkoutItem.packageId,
          checkoutItem.expertPositionId,
        ].filter(Boolean);
        if (productRefs.length !== 1) {
          throw new BadRequestException(
            'Exactly one of serviceId, packageId, or expertPositionId is required for each item',
          );
        }

        let resolvedAmount = Number(checkoutItem.amount);
        let resolvedService: Service | null = null;
        let resolvedPackage: ServicePackage | null = null;

        if (checkoutItem.expertPositionId) {
          const quantity = checkoutItem.quantity ?? 1;
          const expert = await this.expertsService.resolveCheckoutLines({
            positionId: checkoutItem.expertPositionId,
            executorUserId: checkoutItem.executorUserId!,
            offeringIds: checkoutItem.offeringIds!,
          });
          resolvedAmount = expert.amount * quantity;
          if (Math.abs(resolvedAmount - Number(checkoutItem.amount)) > 0.01) {
            throw new BadRequestException(
              'Order amount does not match selected offering prices',
            );
          }

          const order = this.orderRepository.create({
            userId,
            amount: resolvedAmount,
            comments: dto.comments ?? undefined,
            status: OrderStatus.PendingPayment,
            contractorChatAccess: false,
          });
          await queryRunner.manager.save(Order, order);

          const item = this.orderItemRepository.create({
            orderId: order.id,
            expertPositionId: expert.positionId,
            executorUserId: expert.executorUserId,
            serviceId: null,
            packageId: null,
            hours: null,
            amount: resolvedAmount,
            status: OrderStatus.PendingPayment,
          });
          await queryRunner.manager.save(OrderItem, item);

          const offeringIds = expert.offeringLines.map(
            (line) => line.offeringId,
          );
          const offerings = await this.expertOfferingRepository.find({
            where: { id: In(offeringIds), positionId: expert.positionId },
          });
          const priceByOfferingId = new Map(
            expert.offeringLines.map((line) => [
              line.offeringId,
              line.unitPrice,
            ]),
          );
          const subItems = offerings.map((offering) =>
            this.orderItemSubItemRepository.create({
              orderItemId: item.id,
              expertPositionOfferingId: offering.id,
              serviceId: null,
              unitPrice: priceByOfferingId.get(offering.id)! * quantity,
              status: OrderStatus.PendingPayment,
            }),
          );
          if (subItems.length > 0) {
            await queryRunner.manager.save(OrderItemSubItem, subItems);
          }

          for (const line of expert.offeringLines) {
            if (line.giftEligible) {
              giftEligibleAmount += line.unitPrice * quantity;
            }
          }

          totalAmount += resolvedAmount;
          createdOrders.push(order);
          continue;
        }

        if (checkoutItem.serviceId) {
          resolvedService = await this.serviceRepository.findOne({
            where: { id: checkoutItem.serviceId, deletedAt: IsNull() },
          });
          if (!resolvedService) {
            throw new NotFoundException(
              `Service with id ${checkoutItem.serviceId} not found`,
            );
          }
        }
        if (checkoutItem.packageId) {
          resolvedPackage = await this.packageRepository.findOne({
            where: { id: checkoutItem.packageId, deletedAt: IsNull() },
            relations: ['services'],
          });
          if (!resolvedPackage) {
            throw new NotFoundException(
              `Package with id ${checkoutItem.packageId} not found`,
            );
          }
          resolvedAmount = Number(resolvedPackage.price);
        }

        if (resolvedService?.giftEligible) {
          giftEligibleAmount += resolvedAmount;
        } else if (resolvedPackage?.giftEligible) {
          giftEligibleAmount += resolvedAmount;
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
          const packageServices = resolvedPackage?.services ?? [];
          const subItems = packageServices.map((service) =>
            this.orderItemSubItemRepository.create({
              orderItemId: item.id,
              serviceId: service.id,
              status: OrderStatus.PendingPayment,
            }),
          );
          if (subItems.length > 0) {
            await queryRunner.manager.save(OrderItemSubItem, subItems);
          }
        }
        if (checkoutItem.serviceId || checkoutItem.packageId) {
          await this.syncRecommendationForOrder(
            order,
            {
              serviceId: checkoutItem.serviceId ?? null,
              packageId: checkoutItem.packageId ?? null,
            },
            queryRunner.manager,
          );
        }
        totalAmount += resolvedAmount;
        createdOrders.push(order);
      }

      if (Math.abs(totalAmount - Number(dto.amount)) > 0.01) {
        throw new BadRequestException(
          'Order total amount does not match item amounts',
        );
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
          {
            maxGiftAmount: giftEligibleAmount,
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

        try {
          await this.orderNotificationService.notifyOrderPaid(orderIds);
        } catch (notificationError) {
          this.logger.error(
            `notifyOrderPaid failed for orders ${orderIds.join(', ')}: ` +
              `${(notificationError as Error).message}`,
            (notificationError as Error).stack,
          );
        }

        return {
          orderId: primaryOrderId,
          orderIds,
          status: OrderStatus.Planned,
          paymentMethod: CheckoutPaymentMethod.Balance,
        };
      }

      const { paymentUrl, params } =
        await this.paymentService.createWithManager(
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
  ): Promise<{
    data: OrderDto[];
    total: number;
    offset: number;
    limit: number;
  }> {
    const { status, offset = 0, limit = 20 } = query;
    const where: { userId: string; status?: OrderStatus } = { userId };
    if (status) where.status = status;

    const [data, total] = await this.orderRepository.findAndCount({
      where,
      relations: [...ORDER_DETAIL_RELATIONS],
      order: { createdAt: 'DESC' },
      skip: offset,
      take: limit,
    });
    await this.hydrateDeletedExpertOfferingsForOrders(data);
    await this.attachExecutorImagesToOrders(data);
    return {
      data: data.map((order) => this.transformOrderFiles(order)),
      total,
      offset,
      limit,
    };
  }

  async findAssignedToExpert(
    expertUserId: string,
    query: GetOrdersQueryDto,
  ): Promise<{
    data: OrderDto[];
    total: number;
    offset: number;
    limit: number;
  }> {
    const { status, offset = 0, limit = 20 } = query;

    const baseQb = this.orderRepository
      .createQueryBuilder('o')
      .innerJoin('o.item', 'item')
      .leftJoin('item.service', 'service')
      .where(
        new Brackets((qb) => {
          qb.where(
            'service.type = :contractorType AND service."userId" = :expertUserId',
            {
              contractorType: ServiceType.Contractor,
              expertUserId,
            },
          ).orWhere('item."executorUserId" = :expertUserId', { expertUserId });
        }),
      );

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
      relations: [...ORDER_DETAIL_RELATIONS],
      order: { createdAt: 'DESC' },
    });

    await this.hydrateDeletedExpertOfferingsForOrders(data);
    await this.attachExecutorImagesToOrders(data);
    return {
      data: data.map((order) => this.transformOrderFiles(order)),
      total,
      offset,
      limit,
    };
  }

  async findAllForAdmin(query: GetAdminOrdersQueryDto): Promise<{
    data: AdminOrderListItemDto[];
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
      const searchPattern = `%${search}%`;
      baseQb.andWhere(
        new Brackets((qb) => {
          qb.where('o.id::text ILIKE :search', { search: searchPattern })
            .orWhere('o.status ILIKE :search', { search: searchPattern })
            .orWhere('u.name ILIKE :search', { search: searchPattern })
            .orWhere('u."lastName" ILIKE :search', { search: searchPattern })
            .orWhere(`CONCAT(u.name, ' ', u."lastName") ILIKE :search`, {
              search: searchPattern,
            })
            .orWhere(
              `EXISTS (
                SELECT 1 FROM order_item oi
                LEFT JOIN service s ON s.id = oi."serviceId"
                LEFT JOIN service_package sp ON sp.id = oi."packageId"
                WHERE oi."orderId" = o.id
                  AND (s.name ILIKE :search OR sp.name ILIKE :search)
              )`,
              { search: searchPattern },
            )
            .orWhere(
              `EXISTS (
                SELECT 1 FROM order_item oi2
                INNER JOIN order_item_sub_item sub ON sub."orderItemId" = oi2.id
                INNER JOIN expert_position_offering epo ON epo.id = sub."expertPositionOfferingId"
                WHERE oi2."orderId" = o.id
                  AND epo.name ILIKE :search
              )`,
              { search: searchPattern },
            );
        }),
      );
    }

    const total = await baseQb.getCount();

    const rows = await baseQb
      .clone()
      .leftJoin('o.item', 'item')
      .leftJoin('item.service', 'svc')
      .leftJoin(ServicePackage, 'pkg', 'pkg.id = item."packageId"')
      .leftJoin(
        (subQb) =>
          subQb
            .from(OrderItemSubItem, 'sub')
            .leftJoin(
              ExpertPositionOffering,
              'epo',
              'epo.id = sub."expertPositionOfferingId"',
            )
            .select('sub."orderItemId"', 'orderItemId')
            .addSelect('COUNT(sub.id)', 'offeringsCount')
            .addSelect(
              `STRING_AGG(epo.name, ', ' ORDER BY epo.name)`,
              'offeringNames',
            )
            .where('sub."expertPositionOfferingId" IS NOT NULL')
            .groupBy('sub."orderItemId"'),
        'exp_sub',
        'exp_sub."orderItemId" = item.id',
      )
      .select('o.id', 'id')
      .addSelect('CASE WHEN item.id IS NULL THEN 0 ELSE 1 END', 'itemsCount')
      .addSelect(
        `CASE
           WHEN item.id IS NULL THEN 'Услуга'
           WHEN item."expertPositionId" IS NOT NULL THEN
             CASE WHEN COALESCE(exp_sub."offeringsCount", 0) > 1 THEN 'Услуги эксперта' ELSE 'Услуга эксперта' END
           WHEN item."packageId" IS NOT NULL THEN 'Пакет услуг'
           WHEN svc.type IN ('Услуга', 'Документ') THEN svc.type
           ELSE 'Услуга'
         END`,
        'typeLabel',
      )
      .addSelect(
        `CASE
           WHEN item."expertPositionId" IS NOT NULL THEN COALESCE(exp_sub."offeringNames", 'Услуга эксперта')
           ELSE COALESCE(svc.name, pkg.name)
         END`,
        'name',
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
        typeLabel:
          | 'Услуга'
          | 'Документ'
          | 'Пакет услуг'
          | 'Услуга эксперта'
          | 'Услуги эксперта';
        name: string | null;
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
        name: row.name ?? '',
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
      relations: ['user', ...ORDER_DETAIL_RELATIONS],
    });

    if (!order) {
      throw new NotFoundException(`Order with id ${id} not found`);
    }

    await this.hydrateDeletedExpertOfferingsForOrders([order]);
    await this.attachExecutorImagesToOrders([order]);
    return this.transformOrderFiles(order);
  }

  async removeForAdmin(id: string): Promise<void> {
    const order = await this.orderRepository.findOne({
      where: { id },
      relations: ['item', 'item.service'],
    });
    if (!order) {
      throw new NotFoundException(`Order with id ${id} not found`);
    }

    // Revoke expert's platform-chat membership BEFORE deleting the order,
    // otherwise the expert keeps read/write access to the client's private
    // AI chat forever (order gone → contractorChatAccess row gone → nothing
    // triggers removeExpertFromClientPlatformChat later).
    await this.syncContractorChatOnRevoke(order);

    await this.orderRepository.remove(order);
  }

  async updateContractorChatAccessForAdmin(
    id: string,
    dto: UpdateContractorChatAccessDto,
  ): Promise<Order> {
    const order = await this.orderRepository.findOne({
      where: { id },
      relations: ['item', 'item.service'],
    });
    if (!order) {
      throw new NotFoundException(`Order with id ${id} not found`);
    }

    const wasGranted = order.contractorChatAccess === true;
    const willGrant = dto.contractorChatAccess === true;
    const expertUserId = this.resolveOrderExpertUserId(order);
    const shouldSyncParticipant =
      expertUserId !== null && expertUserId !== order.userId;

    // Sync platform-chat membership BEFORE persisting the flag so a failed
    // participant mutation leaves the durable order row unchanged. Retries
    // stay idempotent: ensureParticipant is check-then-insert on grant, and
    // the delete on revoke targets a specific (conversation, user, role)
    // tuple that is a no-op if the expert is already absent.
    if (willGrant && shouldSyncParticipant) {
      await this.chatService.addExpertToClientPlatformChat(
        order.userId,
        expertUserId,
      );
      // Compensation: if we FRESHLY granted access and the flag save then
      // fails, roll the participant back. When wasGranted was already true
      // the addExpertToClientPlatformChat call was a no-op — rolling back
      // in that case would delete the LEGITIMATE existing membership.
      try {
        order.contractorChatAccess = dto.contractorChatAccess;
        return await this.orderRepository.save(order);
      } catch (error) {
        if (!wasGranted) {
          const hasOtherGrant = await this.hasOtherActiveContractorChatGrant(
            order.id,
            order.userId,
            expertUserId,
          );
          if (!hasOtherGrant) {
            await this.chatService
              .removeExpertFromClientPlatformChat(order.userId, expertUserId)
              .catch((err: unknown) =>
                this.logger.error(
                  `Compensation removeExpert failed for order ${order.id}: ${
                    err instanceof Error ? err.message : String(err)
                  }`,
                ),
              );
          }
        }
        throw error;
      }
    }

    if (!willGrant && wasGranted && shouldSyncParticipant) {
      await this.withClientExpertLock(order.userId, expertUserId, async () => {
        const hasOtherGrant = await this.hasOtherActiveContractorChatGrant(
          order.id,
          order.userId,
          expertUserId,
        );
        if (!hasOtherGrant) {
          await this.chatService.removeExpertFromClientPlatformChat(
            order.userId,
            expertUserId,
          );
        }
      });
    }

    order.contractorChatAccess = dto.contractorChatAccess;
    return this.orderRepository.save(order);
  }

  /**
   * Revoke expert's platform-chat membership if THIS order was the last
   * active grant. Serialised per (client, expert) pair via a Postgres
   * advisory lock so two concurrent revokes cannot both read "other grant
   * still active" and skip the delete. Safe to call multiple times
   * (removeExpertFromClientPlatformChat is idempotent). Callers must load
   * `order.item` + `order.item.service` so `resolveOrderExpertUserId` can
   * figure out who the expert was.
   */
  private async syncContractorChatOnRevoke(order: Order): Promise<void> {
    if (!order.contractorChatAccess) return;
    const expertUserId = this.resolveOrderExpertUserId(order);
    if (!expertUserId || expertUserId === order.userId) return;
    await this.withClientExpertLock(order.userId, expertUserId, async () => {
      const hasOtherGrant = await this.hasOtherActiveContractorChatGrant(
        order.id,
        order.userId,
        expertUserId,
      );
      if (hasOtherGrant) return;
      await this.chatService.removeExpertFromClientPlatformChat(
        order.userId,
        expertUserId,
      );
    });
  }

  /**
   * Serialize check-then-remove for a specific (client, expert) pair via
   * a transaction-scoped Postgres advisory lock. Concurrent revoke paths
   * that would otherwise race (two admins revoking the last two grants of
   * the same pair simultaneously) queue up here and see each other's
   * committed state before deciding whether to remove chat membership.
   */
  private async withClientExpertLock<T>(
    clientUserId: string,
    expertUserId: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    const lockKey = `contractor-chat:${clientUserId}:${expertUserId}`;
    return this.dataSource.transaction(async (manager) => {
      await manager.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
        [lockKey],
      );
      return fn();
    });
  }

  /**
   * True when the same (client, expert) pair is entitled to platform-chat
   * access through another still-active order. Used on revoke to preserve
   * membership while any grant remains — the expert only loses access when
   * every order that granted it is revoked (or removed).
   */
  private async hasOtherActiveContractorChatGrant(
    excludeOrderId: string,
    clientUserId: string,
    expertUserId: string,
  ): Promise<boolean> {
    const qb = this.orderRepository
      .createQueryBuilder('o')
      .leftJoin('o.item', 'oi')
      .leftJoin('oi.service', 's')
      .where('o.id != :excludeOrderId', { excludeOrderId })
      .andWhere('o."userId" = :clientUserId', { clientUserId })
      .andWhere('o."contractorChatAccess" = true')
      // Cancelled orders keep their historical `contractorChatAccess = true`
      // flag but must NOT count as an active grant — the expert should lose
      // chat membership when the last non-cancelled order granting access is
      // revoked or removed.
      .andWhere('o.status != :cancelledStatus', {
        cancelledStatus: OrderStatus.Cancelled,
      })
      .andWhere(
        new Brackets((qbInner) => {
          qbInner
            .where('oi."executorUserId" = :expertUserId', { expertUserId })
            .orWhere(
              's."userId" = :expertUserId AND s."type" = :contractorType',
              {
                expertUserId,
                contractorType: ServiceType.Contractor,
              },
            );
        }),
      );

    const count = await qb.getCount();
    return count > 0;
  }

  private resolveOrderExpertUserId(order: Order): string | null {
    if (order.item?.executorUserId) {
      return order.item.executorUserId;
    }
    // Legacy contractor path — only honour it when the linked service is
    // explicitly of type Contractor, otherwise service.userId is the
    // catalogue owner (typically an admin), NOT the expert.
    const service = order.item?.service;
    if (service?.type === ServiceType.Contractor && service.userId) {
      return service.userId;
    }
    return null;
  }

  async updateStatusForAdmin(
    id: string,
    dto: UpdateOrderStatusDto,
  ): Promise<Order> {
    const order = await this.orderRepository.findOne({
      where: { id },
      relations: ['item', 'item.service'],
    });
    if (!order) {
      throw new NotFoundException(`Order with id ${id} not found`);
    }
    this.assertOrderNotPendingPaymentForManualStatusChange(order);
    if (order.item?.packageId || order.item?.expertPositionId) {
      throw new BadRequestException(
        'Статус составного заказа вычисляется по статусам услуг внутри — обновите статусы услуг',
      );
    }

    const previousStatus = order.status;
    // Chat revoke MUST run BEFORE the status save so a chat-service failure
    // aborts the whole transition. If we saved first and the revoke then
    // threw, the order would be stuck as Cancelled forever with the expert
    // still able to read the chat — a retry would see previousStatus =
    // Cancelled and skip the sync.
    if (
      previousStatus !== OrderStatus.Cancelled &&
      dto.status === OrderStatus.Cancelled
    ) {
      order.status = OrderStatus.Cancelled;
      await this.syncContractorChatOnRevoke(order);
    }
    order.status = dto.status;
    const savedOrder = await this.orderRepository.save(order);
    if (order.item?.serviceId) {
      await this.syncRecommendationForOrder(savedOrder, {
        serviceId: order.item.serviceId,
      });
    } else if (order.item?.packageId) {
      await this.syncRecommendationForOrder(savedOrder, {
        packageId: order.item.packageId,
      });
    }
    return savedOrder;
  }

  async updateItemStatusForAdmin(
    itemId: string,
    status: OrderStatus,
  ): Promise<OrderItem> {
    const item = await this.orderItemRepository.findOne({
      where: { id: itemId },
      relations: ['order', 'order.item', 'order.item.service', 'subItems'],
    });
    if (!item) {
      throw new NotFoundException(`Order item with id ${itemId} not found`);
    }
    this.assertOrderNotPendingPaymentForManualStatusChange(item.order);
    if (item.packageId || item.expertPositionId) {
      throw new BadRequestException(
        'Для составного заказа используйте смену статуса по каждой услуге',
      );
    }

    // For a simple (non-composite) order item is 1:1 with order — item.status
    // and order.status must move together, otherwise cancelling the item via
    // this endpoint leaves the parent order in its old status and the expert
    // keeps chat membership.
    const previousOrderStatus = item.order.status;
    const orderJustCancelled =
      previousOrderStatus !== OrderStatus.Cancelled &&
      status === OrderStatus.Cancelled;

    if (orderJustCancelled) {
      // Revoke BEFORE persisting so a chat-service failure leaves the order
      // and item untouched — see the same pattern in updateStatusForAdmin.
      await this.syncContractorChatOnRevoke(item.order);
    }

    item.status = status;
    const savedItem = await this.orderItemRepository.save(item);

    if (orderJustCancelled) {
      item.order.status = OrderStatus.Cancelled;
      await this.orderRepository.save(item.order);
    }

    if (savedItem.serviceId) {
      await this.syncRecommendationForOrder(savedItem.order, {
        serviceId: savedItem.serviceId,
      });
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
        relations: [
          'order',
          'subItems',
          'subItems.service',
          'subItems.expertPositionOffering',
        ],
      });
      if (!item) {
        throw new NotFoundException(`Order item with id ${itemId} not found`);
      }
      this.assertOrderNotPendingPaymentForManualStatusChange(item.order);
      if (!item.packageId && !item.expertPositionId) {
        throw new BadRequestException(
          'Эта позиция заказа не является пакетом или заказом эксперта',
        );
      }
      if (!item.subItems.length) {
        throw new BadRequestException('В заказе нет вложенных услуг');
      }

      const subItem = item.subItems.find((entry) => entry.id === subItemId);
      if (!subItem) {
        throw new NotFoundException(
          `Order sub-item with id ${subItemId} not found`,
        );
      }

      await this.recommendationUserLockService.lockUser(
        item.order.userId,
        queryRunner.manager,
      );

      await this.hydrateDeletedExpertOfferings(item.subItems);

      await subItemRepo.update({ id: subItemId }, { status });
      subItem.status = status;

      const recalculatedStatus = this.calculatePackageItemStatusFromSubItems(
        item.subItems,
      );
      const prevStatus = item.status;
      await itemRepo.update({ id: itemId }, { status: recalculatedStatus });
      item.status = recalculatedStatus;

      const orderRepo = queryRunner.manager.getRepository(Order);
      const parentOrder = await orderRepo.findOne({
        where: { id: item.orderId },
      });
      let parentJustCancelled = false;
      if (parentOrder && parentOrder.status !== recalculatedStatus) {
        parentJustCancelled =
          parentOrder.status !== OrderStatus.Cancelled &&
          recalculatedStatus === OrderStatus.Cancelled;
        parentOrder.status = recalculatedStatus;
        await orderRepo.save(parentOrder);
      }

      if (prevStatus !== recalculatedStatus) {
        const recommendation = await queryRunner.manager
          .getRepository(Recommendation)
          .findOne({
            where: { orderId: item.orderId },
          });
        if (recommendation) {
          recommendation.status =
            this.mapOrderStatusToRecommendationStatus(recalculatedStatus);
          recommendation.orderId =
            recalculatedStatus === OrderStatus.Cancelled ? null : item.orderId;
          await queryRunner.manager
            .getRepository(Recommendation)
            .save(recommendation);
        }
      }

      // Chat revoke runs BEFORE commit so a chat-service failure rolls the
      // whole transaction back and a retry re-computes parentJustCancelled.
      // The chat call uses the default connection (not this queryRunner),
      // so on a chat-side failure we throw → outer catch → rollback → order
      // state stays untouched → next retry can try again. If chat succeeds
      // but the commit right after fails, the expert is TEMPORARILY removed
      // — the same retry will re-add via the normal grant path.
      if (parentJustCancelled) {
        const orderForRevoke = await queryRunner.manager
          .getRepository(Order)
          .findOne({
            where: { id: item.orderId },
            relations: ['item', 'item.service'],
          });
        if (orderForRevoke) {
          await this.syncContractorChatOnRevoke(orderForRevoke);
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
