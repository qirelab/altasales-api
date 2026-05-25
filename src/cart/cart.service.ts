import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ServicePackage } from '../packages/entities/package.entity';
import { Service } from '../services/entities/service.entity';
import { AddCartItemDto } from './dto/add-cart-item.dto';
import { UpdateCartItemDto } from './dto/update-cart-item.dto';
import { CartItem } from './entities/cart-item.entity';
import { Cart } from './entities/cart.entity';
import { CartStatus } from './entities/cart-status.enum';

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
  ) {}

  async getMyCart(userId: string) {
    const cart = await this.ensureActiveCart(userId);
    const items = await this.cartItemRepository.find({
      where: { cartId: cart.id },
      relations: ['service', 'service.category', 'package', 'package.category', 'package.services'],
      order: { createdAt: 'ASC' },
    });

    return {
      id: cart.id,
      items: items.map((item) => ({
        id: item.id,
        serviceId: item.serviceId,
        packageId: item.packageId,
        quantity: item.quantity,
        service: item.service,
        package: item.package,
      })),
    };
  }

  async addItem(userId: string, dto: AddCartItemDto) {
    const cart = await this.ensureActiveCart(userId);
    if (dto.serviceId) {
      await this.requireService(dto.serviceId);
    }
    if (dto.packageId) {
      await this.requirePackage(dto.packageId);
    }

    const where = dto.serviceId
      ? { cartId: cart.id, serviceId: dto.serviceId }
      : { cartId: cart.id, packageId: dto.packageId! };

    const existing = await this.cartItemRepository.findOne({
      where,
    });
    if (existing) {
      existing.quantity += dto.quantity ?? 1;
      await this.cartItemRepository.save(existing);
      return this.getMyCart(userId);
    }

    await this.cartItemRepository.save(
      this.cartItemRepository.create({
        cartId: cart.id,
        serviceId: dto.serviceId ?? null,
        packageId: dto.packageId ?? null,
        quantity: dto.quantity ?? 1,
      }),
    );
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
    const service = await this.serviceRepository.findOne({ where: { id: serviceId } });
    if (!service) {
      throw new NotFoundException(`Service with id ${serviceId} not found`);
    }
    return service;
  }

  private async requirePackage(packageId: string): Promise<ServicePackage> {
    const servicePackage = await this.packageRepository.findOne({ where: { id: packageId } });
    if (!servicePackage) {
      throw new NotFoundException(`Package with id ${packageId} not found`);
    }
    return servicePackage;
  }
}
