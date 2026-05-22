import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, In, Repository } from 'typeorm';
import { Order } from '../orders/entities/order.entity';
import { OrderItem } from '../orders/entities/order-item.entity';
import { CreatePackageDto } from './dto/create-package.dto';
import { GetAdminPackagesQueryDto } from './dto/get-admin-packages-query.dto';
import { UpdatePackageDto } from './dto/update-package.dto';
import { ServicePackage } from './entities/package.entity';
import { Service } from '../services/entities/service.entity';
import { Category } from '../categories/entities/category.entity';
import { ServiceType } from '../services/entities/service-type.enum';

export interface AdminPackageListItem {
  id: string;
  name: string;
  description: string;
  tags: string[];
  packageType: string;
  price: number;
  categoryId: string | null;
  category: { id: string; name: string; slug: string } | null;
  services: { id: string; name: string }[];
  createdAt: Date;
  ordersCount: number;
}

export interface AdminPackageOrderRow {
  id: string;
  clientName: string;
  clientLastName: string;
  createdAt: Date;
  amount: number;
  status: string;
}

@Injectable()
export class PackagesService {
  constructor(
    @InjectRepository(ServicePackage)
    private readonly packageRepository: Repository<ServicePackage>,
    @InjectRepository(Service)
    private readonly serviceRepository: Repository<Service>,
    @InjectRepository(Category)
    private readonly categoryRepository: Repository<Category>,
    @InjectRepository(Order)
    private readonly orderRepository: Repository<Order>,
    @InjectRepository(OrderItem)
    private readonly orderItemRepository: Repository<OrderItem>,
  ) { }

  async create(createPackageDto: CreatePackageDto): Promise<ServicePackage> {
    if (createPackageDto.categoryId) {
      await this.ensureCategoryExists(createPackageDto.categoryId);
    }

    const services = await this.resolvePackageServices(createPackageDto.serviceIds);

    const servicePackage = this.packageRepository.create({
      ...createPackageDto,
      tags: createPackageDto.tags ?? [],
      services,
    });

    return this.packageRepository.save(servicePackage);
  }

  async findAll(): Promise<ServicePackage[]> {
    return this.packageRepository.find({
      relations: ['category'],
      order: { createdAt: 'DESC' },
    });
  }

  async findOne(id: string): Promise<ServicePackage> {
    const servicePackage = await this.packageRepository.findOne({
      where: { id },
      relations: ['category'],
    });

    if (!servicePackage) {
      throw new NotFoundException(`Пакет с ID ${id} не найден`);
    }

    return servicePackage;
  }

  async update(id: string, updatePackageDto: UpdatePackageDto): Promise<ServicePackage> {
    const servicePackage = await this.findOne(id);
    const { serviceIds, ...packageFields } = updatePackageDto;

    if (packageFields.categoryId) {
      await this.ensureCategoryExists(packageFields.categoryId);
    }

    const services = serviceIds !== undefined
      ? await this.resolvePackageServices(serviceIds)
      : servicePackage.services;

    Object.assign(servicePackage, {
      ...packageFields,
      services,
    });

    if (updatePackageDto.tags === undefined && !servicePackage.tags) {
      servicePackage.tags = [];
    }

    return this.packageRepository.save(servicePackage);
  }

  async remove(id: string): Promise<void> {
    const servicePackage = await this.findOne(id);
    const referencingOrderItems = await this.orderItemRepository.count({
      where: { packageId: id },
    });
    if (referencingOrderItems > 0) {
      throw new ConflictException(
        'Нельзя удалить пакет, который используется в заказах. Удалите или измените связанные заказы.',
      );
    }
    await this.packageRepository.remove(servicePackage);
  }

  async findAllPackagesForAdmin(query: GetAdminPackagesQueryDto): Promise<{
    data: AdminPackageListItem[];
    total: number;
    offset: number;
    limit: number;
  }> {
    const { offset = 0, limit = 20 } = query;
    const search = query.search?.trim();

    const qb = this.packageRepository
      .createQueryBuilder('p')
      .leftJoinAndSelect('p.category', 'c')
      .leftJoinAndSelect('p.services', 's');

    if (search) {
      qb.where(
        new Brackets((sub) => {
          sub
            .where('p.name ILIKE :search', { search: `%${search}%` })
            .orWhere('p.description ILIKE :search', { search: `%${search}%` })
            .orWhere('p.packageType ILIKE :search', { search: `%${search}%` })
            .orWhere('c.name ILIKE :search', { search: `%${search}%` });
        }),
      );
    }

    const total = await qb.getCount();

    const packages = await qb
      .orderBy('p.createdAt', 'DESC')
      .skip(offset)
      .take(limit)
      .getMany();

    const packageIds = packages.map((pkg) => pkg.id);
    const ordersMap = await this.buildOrdersCountMap(packageIds);

    return {
      data: packages.map((pkg) => this.mapPackageListItem(pkg, ordersMap.get(pkg.id) ?? 0)),
      total,
      offset,
      limit,
    };
  }

  async findOnePackageForAdmin(id: string): Promise<{
    package: ServicePackage;
    ordersCount: number;
    totalItemsAmount: number;
    orders: AdminPackageOrderRow[];
  }> {
    const servicePackage = await this.packageRepository.findOne({
      where: { id },
      relations: ['category', 'services', 'services.category'],
    });

    if (!servicePackage) {
      throw new NotFoundException(`Пакет с ID ${id} не найден`);
    }

    const ordersCount = await this.orderItemRepository.count({ where: { packageId: id } });

    const ordersRaw = await this.orderRepository
      .createQueryBuilder('o')
      .innerJoin('o.item', 'item', 'item."packageId" = :packageId', { packageId: id })
      .leftJoin('o.user', 'u')
      .select('o.id', 'id')
      .addSelect('u.name', 'clientName')
      .addSelect('u.lastName', 'clientLastName')
      .addSelect('o."createdAt"', 'createdAt')
      .addSelect('o.amount', 'amount')
      .addSelect('o.status', 'status')
      .orderBy('o."createdAt"', 'DESC')
      .getRawMany<{
        id: string;
        clientName: string | null;
        clientLastName: string | null;
        createdAt: Date;
        amount: string;
        status: string;
      }>();

    const orders: AdminPackageOrderRow[] = ordersRaw.map((row) => ({
      id: row.id,
      clientName: row.clientName ?? '',
      clientLastName: row.clientLastName ?? '',
      createdAt: row.createdAt,
      amount: Number(row.amount),
      status: row.status,
    }));

    const totalItemsAmount = (servicePackage.services ?? []).reduce(
      (sum, service) => sum + Number(service.price),
      0,
    );

    return {
      package: servicePackage,
      ordersCount,
      totalItemsAmount,
      orders,
    };
  }

  private async buildOrdersCountMap(packageIds: string[]): Promise<Map<string, number>> {
    if (packageIds.length === 0) return new Map();

    const rows = await this.orderItemRepository
      .createQueryBuilder('oi')
      .select('oi."packageId"', 'packageId')
      .addSelect('COUNT(DISTINCT oi."orderId")', 'count')
      .where('oi."packageId" IN (:...ids)', { ids: packageIds })
      .groupBy('oi."packageId"')
      .getRawMany<{ packageId: string; count: string }>();

    return new Map(rows.map((row) => [row.packageId, Number(row.count)]));
  }

  private mapPackageListItem(pkg: ServicePackage, ordersCount: number): AdminPackageListItem {
    return {
      id: pkg.id,
      name: pkg.name,
      description: pkg.description,
      tags: pkg.tags ?? [],
      packageType: pkg.packageType,
      price: Number(pkg.price),
      categoryId: pkg.categoryId,
      category: pkg.category
        ? { id: pkg.category.id, name: pkg.category.name, slug: pkg.category.slug }
        : null,
      services: (pkg.services ?? []).map((service) => ({ id: service.id, name: service.name })),
      createdAt: pkg.createdAt,
      ordersCount,
    };
  }

  private async ensureCategoryExists(categoryId: string): Promise<void> {
    const category = await this.categoryRepository.findOne({ where: { id: categoryId } });
    if (!category) {
      throw new NotFoundException(`Категория с ID ${categoryId} не найдена`);
    }
  }

  private async resolvePackageServices(serviceIds?: string[]): Promise<Service[]> {
    if (!serviceIds || serviceIds.length === 0) {
      return [];
    }

    const services = await this.serviceRepository.find({
      where: {
        id: In(serviceIds),
      },
    });
    const serviceIdsSet = new Set(services.map((service) => service.id));
    const missingIds = serviceIds.filter((id) => !serviceIdsSet.has(id));

    if (missingIds.length > 0) {
      throw new NotFoundException(`Услуги с ID ${missingIds.join(', ')} не найдены`);
    }

    const invalidServiceIds = services
      .filter((service) => service.type !== ServiceType.Service)
      .map((service) => service.id);

    if (invalidServiceIds.length > 0) {
      throw new ConflictException(
        `В пакет можно добавлять только услуги. Неверные ID: ${invalidServiceIds.join(', ')}`,
      );
    }

    return services;
  }
}
