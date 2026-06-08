import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { ExpertsService } from '../experts/experts.service';
import { ServicePackage } from '../packages/entities/package.entity';
import { activePackageWhere, isPackageActive } from '../packages/package-visibility';
import { Service } from '../services/entities/service.entity';
import { activeServiceWhere, filterActiveServices, isServiceActive } from '../services/service-visibility';
import { mapCartExpertItem } from './cart-expert.helper';
import { AddCartItemDto } from './dto/add-cart-item.dto';
import { UpdateCartItemDto } from './dto/update-cart-item.dto';
import { CartItem } from './entities/cart-item.entity';
import { CartItemOffering } from './entities/cart-item-offering.entity';
import { Cart } from './entities/cart.entity';
import { CartStatus } from './entities/cart-status.enum';

const EXPERT_RELATIONS = [
  'expertPosition',
  'executor',
  'offerings',
  'offerings.expertPositionOffering',
];

@Injectable()
export class CartService {
  constructor(
    @InjectRepository(Cart)
    private readonly cartRepository: Repository<Cart>,
    @InjectRepository(CartItem)
    private readonly cartItemRepository: Repository<CartItem>,
    @InjectRepository(Service)
    private readonly serviceRepository: Repository<Service>,
    @InjectRepository(ServicePackage)
    private readonly packageRepository: Repository<ServicePackage>,
    private readonly dataSource: DataSource,
    private readonly expertsService: ExpertsService,
  ) {}

  async getMyCart(userId: string) {
    const cart = await this.ensureActiveCart(userId);
    const items = await this.cartItemRepository.find({
      where: { cartId: cart.id },
      relations: [
        'service',
        'service.category',
        'package',
        'package.category',
        'package.services',
        ...EXPERT_RELATIONS,
      ],
      order: { createdAt: 'ASC' },
    });

    const expertItemsRaw = items.filter((item) => Boolean(item.expertPositionId));
    const positionIds = [...new Set(expertItemsRaw.map((item) => item.expertPositionId!))];
    const positionMap = new Map<string, Awaited<ReturnType<ExpertsService['findPositionById']>>>();
    for (const positionId of positionIds) {
      try {
        const position = await this.expertsService.findPositionById(positionId);
        positionMap.set(positionId, position);
      } catch {
        positionMap.set(positionId, null as never);
      }
    }

    const mapped = items
      .map((item) => {
        if (item.serviceId) {
          if (!isServiceActive(item.service)) return null;
          return {
            id: item.id,
            serviceId: item.serviceId,
            packageId: null,
            quantity: item.quantity,
            service: item.service,
            package: null,
            expertItem: null,
          };
        }
        if (item.packageId) {
          if (!isPackageActive(item.package)) return null;
          item.package!.services = filterActiveServices(item.package!.services);
          return {
            id: item.id,
            serviceId: null,
            packageId: item.packageId,
            quantity: item.quantity,
            service: null,
            package: item.package,
            expertItem: null,
          };
        }
        if (item.expertPositionId) {
          const position = positionMap.get(item.expertPositionId);
          if (!position) return null;
          const expertItem = mapCartExpertItem(item, position);
          if (!expertItem) return null;
          return {
            id: item.id,
            serviceId: null,
            packageId: null,
            quantity: item.quantity,
            service: null,
            package: null,
            expertItem,
          };
        }
        return null;
      })
      .filter((item): item is NonNullable<typeof item> => item !== null);

    return {
      id: cart.id,
      items: mapped,
    };
  }

  async addItem(userId: string, dto: AddCartItemDto) {
    const cart = await this.ensureActiveCart(userId);

    if (dto.serviceId) {
      await this.requireService(dto.serviceId);
      return this.addOrIncrement(cart.id, { serviceId: dto.serviceId }, dto.quantity, userId);
    }
    if (dto.packageId) {
      await this.requirePackage(dto.packageId);
      return this.addOrIncrement(cart.id, { packageId: dto.packageId }, dto.quantity, userId);
    }

    return this.addExpertItem(cart.id, dto, userId);
  }

  private async addOrIncrement(
    cartId: string,
    where: { serviceId?: string; packageId?: string },
    quantity: number | undefined,
    userId: string,
  ) {
    const existing = await this.cartItemRepository.findOne({ where: { cartId, ...where } });
    if (existing) {
      existing.quantity += quantity ?? 1;
      await this.cartItemRepository.save(existing);
      return this.getMyCart(userId);
    }
    await this.cartItemRepository.save(
      this.cartItemRepository.create({
        cartId,
        serviceId: where.serviceId ?? null,
        packageId: where.packageId ?? null,
        quantity: quantity ?? 1,
      }),
    );
    return this.getMyCart(userId);
  }

  private async addExpertItem(cartId: string, dto: AddCartItemDto, userId: string) {
    const positionId = dto.expertPositionId!;
    const executorUserId = dto.executorUserId!;
    const offeringIds = dto.offeringIds!;

    try {
      await this.expertsService.resolveCheckoutLines({ positionId, executorUserId, offeringIds });
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      if (error instanceof NotFoundException) throw new BadRequestException(error.message);
      throw error;
    }

    const existing = await this.cartItemRepository.findOne({
      where: { cartId, expertPositionId: positionId },
      relations: ['offerings'],
    });

    if (existing) {
      await this.dataSource.transaction(async (manager) => {
        existing.executorUserId = executorUserId;
        await manager.save(CartItem, existing);
        await manager.delete(CartItemOffering, { cartItemId: existing.id });
        await manager.save(
          CartItemOffering,
          offeringIds.map((offeringId) => manager.create(CartItemOffering, {
            cartItemId: existing.id,
            expertPositionOfferingId: offeringId,
          })),
        );
      });
      return this.getMyCart(userId);
    }

    await this.dataSource.transaction(async (manager) => {
      const item = manager.create(CartItem, {
        cartId,
        serviceId: null,
        packageId: null,
        expertPositionId: positionId,
        executorUserId,
        quantity: 1,
      });
      const savedItem = await manager.save(CartItem, item);
      await manager.save(
        CartItemOffering,
        offeringIds.map((offeringId) => manager.create(CartItemOffering, {
          cartItemId: savedItem.id,
          expertPositionOfferingId: offeringId,
        })),
      );
    });
    return this.getMyCart(userId);
  }

  async updateItemQuantity(userId: string, itemId: string, dto: UpdateCartItemDto) {
    const cart = await this.ensureActiveCart(userId);
    const existing = await this.cartItemRepository.findOne({
      where: { cartId: cart.id, id: itemId },
    });
    if (!existing) {
      throw new NotFoundException('Cart item not found');
    }
    if (existing.expertPositionId) {
      throw new BadRequestException('Quantity is not applicable for expert position cart items');
    }
    existing.quantity = dto.quantity;
    await this.cartItemRepository.save(existing);
    return this.getMyCart(userId);
  }

  async removeItem(userId: string, itemId: string) {
    const cart = await this.ensureActiveCart(userId);
    await this.cartItemRepository.delete({ cartId: cart.id, id: itemId });
    return this.getMyCart(userId);
  }

  async clear(userId: string) {
    const cart = await this.ensureActiveCart(userId);
    await this.cartItemRepository.delete({ cartId: cart.id });
    return this.getMyCart(userId);
  }

  async clearAndArchiveActiveCart(userId: string): Promise<void> {
    const cart = await this.cartRepository.findOne({
      where: { userId, status: CartStatus.Active },
    });
    if (!cart) return;

    await this.cartItemRepository.delete({ cartId: cart.id });
    cart.status = CartStatus.CheckedOut;
    await this.cartRepository.save(cart);
  }

  private async ensureActiveCart(userId: string): Promise<Cart> {
    const existing = await this.cartRepository.findOne({
      where: { userId, status: CartStatus.Active },
    });
    if (existing) return existing;

    return this.cartRepository.save(
      this.cartRepository.create({ userId, status: CartStatus.Active }),
    );
  }

  private async requireService(serviceId: string): Promise<Service> {
    const service = await this.serviceRepository.findOne({
      where: { id: serviceId, ...activeServiceWhere() },
    });
    if (!service) {
      throw new NotFoundException(`Service with id ${serviceId} not found`);
    }
    return service;
  }

  private async requirePackage(packageId: string): Promise<ServicePackage> {
    const servicePackage = await this.packageRepository.findOne({
      where: { id: packageId, ...activePackageWhere() },
    });
    if (!servicePackage) {
      throw new NotFoundException(`Package with id ${packageId} not found`);
    }
    return servicePackage;
  }
}
