import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { ExpertPositionDetailDto, ExpertsService } from '../experts/experts.service';
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
  private readonly logger = new Logger(CartService.name);

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
        'package.categories',
        'package.services',
        ...EXPERT_RELATIONS,
      ],
      order: { createdAt: 'ASC' },
    });

    const expertItemsRaw = items.filter((item) => Boolean(item.expertPositionId));
    const positionIds = [...new Set(expertItemsRaw.map((item) => item.expertPositionId!))];
    const positionMap = new Map<string, ExpertPositionDetailDto | null>();
    for (const positionId of positionIds) {
      try {
        const position = await this.expertsService.findPositionById(positionId);
        positionMap.set(positionId, position);
      } catch (error) {
        this.logger.warn(
          `Failed to resolve expert position ${positionId} for cart ${cart.id}: ${(error as Error)?.message}`,
        );
        positionMap.set(positionId, null);
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
          if (!expertItem) {
            this.logger.warn(
              `Skipped expert cart_item ${item.id} (cart ${cart.id}) — stale executor or missing offering prices`,
            );
            return null;
          }
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
    const offeringIds = [...new Set(dto.offeringIds!)];
    const quantityToAdd = dto.quantity ?? 1;

    try {
      await this.expertsService.resolveCheckoutLines({ positionId, executorUserId, offeringIds });
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      if (error instanceof NotFoundException) throw new BadRequestException(error.message);
      if (error instanceof ConflictException) throw new BadRequestException(error.message);
      throw error;
    }

    const existing = await this.cartItemRepository.findOne({
      where: {
        cartId,
        expertPositionId: positionId,
        executorUserId,
      },
      relations: ['offerings'],
    });

    if (existing) {
      const offeringsById = new Map(
        (existing.offerings ?? []).map((offering) => [offering.expertPositionOfferingId, offering]),
      );
      const missingOfferingIds = offeringIds.filter((offeringId) => !offeringsById.has(offeringId));
      const existingOfferings = offeringIds
        .map((offeringId) => offeringsById.get(offeringId))
        .filter((offering): offering is CartItemOffering => Boolean(offering));

      if (missingOfferingIds.length > 0 || existingOfferings.length > 0) {
        await this.dataSource.transaction(async (manager) => {
          await manager.update(CartItem, { id: existing.id }, { quantity: 1 });

          if (existingOfferings.length > 0) {
            existingOfferings.forEach((offering) => {
              offering.quantity += quantityToAdd;
            });
            await manager.save(
              CartItemOffering,
              existingOfferings,
            );
          }

          if (missingOfferingIds.length > 0) {
            await manager.save(
              CartItemOffering,
              missingOfferingIds.map((offeringId) => manager.create(CartItemOffering, {
                cartItemId: existing.id,
                expertPositionOfferingId: offeringId,
                quantity: quantityToAdd,
              })),
            );
          }
        });
      }

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
          quantity: quantityToAdd,
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
    existing.quantity = dto.quantity;
    await this.cartItemRepository.save(existing);
    return this.getMyCart(userId);
  }

  async updateExpertOfferingQuantity(
    userId: string,
    itemId: string,
    offeringId: string,
    dto: UpdateCartItemDto,
  ) {
    const cart = await this.ensureActiveCart(userId);
    const existing = await this.cartItemRepository.findOne({
      where: { cartId: cart.id, id: itemId },
      relations: ['offerings'],
    });
    if (!existing || !existing.expertPositionId) {
      throw new NotFoundException('Expert cart item not found');
    }

    const offeringEntry = (existing.offerings ?? [])
      .find((offering) => offering.expertPositionOfferingId === offeringId);
    if (!offeringEntry) {
      throw new NotFoundException('Offering not found in cart item');
    }

    offeringEntry.quantity = dto.quantity;
    await this.dataSource.manager.save(CartItemOffering, offeringEntry);
    return this.getMyCart(userId);
  }

  async removeExpertOffering(userId: string, itemId: string, offeringId: string) {
    const cart = await this.ensureActiveCart(userId);
    const existing = await this.cartItemRepository.findOne({
      where: { cartId: cart.id, id: itemId },
      relations: ['offerings'],
    });
    if (!existing || !existing.expertPositionId) {
      throw new NotFoundException('Expert cart item not found');
    }

    const offeringEntry = (existing.offerings ?? [])
      .find((offering) => offering.expertPositionOfferingId === offeringId);
    if (!offeringEntry) {
      throw new NotFoundException('Offering not found in cart item');
    }

    if ((existing.offerings?.length ?? 0) <= 1) {
      await this.cartItemRepository.delete({ cartId: cart.id, id: itemId });
      return this.getMyCart(userId);
    }

    await this.dataSource.transaction(async (manager) => {
      await manager.delete(CartItemOffering, { id: offeringEntry.id, cartItemId: existing.id });
    });

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
