import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, DataSource, In, IsNull, Repository } from 'typeorm';
import { Category } from '../categories/entities/category.entity';
import { Order } from '../orders/entities/order.entity';
import { OrderItem } from '../orders/entities/order-item.entity';
import { Service } from '../services/entities/service.entity';
import { ServiceType } from '../services/entities/service-type.enum';
import { filterActiveServices } from '../services/service-visibility';
import { CreatePackageDto } from './dto/create-package.dto';
import { GetAdminPackagesQueryDto } from './dto/get-admin-packages-query.dto';
import { UpdatePackageDto } from './dto/update-package.dto';
import { ServicePackage } from './entities/package.entity';
import {
  activePackageWhere,
  applyActivePackageFilter,
  applyPublicPackageFilter,
} from './package-visibility';

export interface AdminPackageListItem {
  id: string;
  name: string;
  description: string;
  tags: string[];
  packageType: string;
  price: number;
  giftEligible: boolean;
  image: string | null;
  imageOriginal: string | null;
  isHidden: boolean;
  categoryId: string | null;
  category: { id: string; name: string; slug: string } | null;
  categoryIds: string[];
  categories: Array<{ id: string; name: string; slug: string }>;
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

function resolvePackageCategoryIds(dto: {
  categoryIds?: string[] | null;
  categoryId?: string | null;
}): string[] | null {
  if (dto.categoryIds !== undefined) {
    return dto.categoryIds ?? [];
  }
  if (dto.categoryId !== undefined) {
    return dto.categoryId ? [dto.categoryId] : [];
  }
  return null;
}

function categoriesRefs(ids: string[]): Category[] {
  return ids.map((id) => ({ id } as Category));
}

function normalizePackageName(name: string): string {
  return name.trim().replace(/\s+/g, ' ');
}

function attachLegacyPackageCategory<T extends { categories?: Category[] | null }>(
  entity: T,
): T & { category: Category | null; categoryId: string | null } {
  const first = entity.categories?.[0] ?? null;
  return Object.assign(entity, {
    category: first,
    categoryId: first?.id ?? null,
  });
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
    private readonly dataSource: DataSource,
  ) { }

  async create(createPackageDto: CreatePackageDto): Promise<ServicePackage> {
    const normalizedName = normalizePackageName(createPackageDto.name);
    await this.ensurePackageNameUnique(normalizedName);

    const categoryIds = resolvePackageCategoryIds(createPackageDto) ?? [];
    await this.ensureCategoriesExist(categoryIds);

    const services = await this.resolvePackageServices(createPackageDto.serviceIds);

    const { categoryId: _legacyId, categoryIds: _newIds, ...rest } = createPackageDto;
    const servicePackage = this.packageRepository.create({
      ...rest,
      name: normalizedName,
      tags: createPackageDto.tags ?? [],
      image: createPackageDto.image ?? null,
      services,
      categories: categoriesRefs(categoryIds),
    });

    const saved = await this.packageRepository.save(servicePackage);
    return this.loadWithCategories(saved.id);
  }

  async findAll(): Promise<ServicePackage[]> {
    const packages = await applyPublicPackageFilter(
      this.packageRepository
        .createQueryBuilder('sp')
        .leftJoinAndSelect('sp.categories', 'category', 'category."isHidden" = false')
        .leftJoinAndSelect(
          'sp.services',
          's',
          's."deletedAt" IS NULL AND s."isHidden" = false',
        ),
      'sp',
    )
      .andWhere(`(
        NOT EXISTS (
          SELECT 1 FROM "package_categories" pc WHERE pc."packageId" = sp.id
        ) OR category.id IS NOT NULL
      )`)
      .orderBy('sp."createdAt"', 'DESC')
      .getMany();
    return packages.map((pkg) => attachLegacyPackageCategory(pkg));
  }

  async findOne(id: string): Promise<ServicePackage> {
    const servicePackage = await applyPublicPackageFilter(
      this.packageRepository
        .createQueryBuilder('sp')
        .leftJoinAndSelect('sp.categories', 'category', 'category."isHidden" = false')
        .leftJoinAndSelect(
          'sp.services',
          's',
          's."deletedAt" IS NULL AND s."isHidden" = false',
        ),
      'sp',
    )
      .andWhere('sp.id = :id', { id })
      .andWhere(`(
        NOT EXISTS (
          SELECT 1 FROM "package_categories" pc WHERE pc."packageId" = sp.id
        ) OR category.id IS NOT NULL
      )`)
      .getOne();

    if (!servicePackage) {
      throw new NotFoundException(`Пакет с ID ${id} не найден`);
    }

    return attachLegacyPackageCategory(servicePackage);
  }

  private async loadWithCategories(id: string): Promise<ServicePackage> {
    const servicePackage = await this.packageRepository.findOne({
      where: { id },
      relations: ['categories'],
    });
    if (!servicePackage) {
      throw new NotFoundException(`Пакет с ID ${id} не найден`);
    }
    return attachLegacyPackageCategory(servicePackage);
  }

  async update(id: string, updatePackageDto: UpdatePackageDto): Promise<ServicePackage> {
    const servicePackage = await this.packageRepository.findOne({
      where: { id, ...activePackageWhere() },
      relations: ['categories', 'services'],
    });

    if (!servicePackage) {
      throw new NotFoundException(`Пакет с ID ${id} не найден`);
    }

    const {
      serviceIds,
      categoryId: _legacyId,
      categoryIds: _newIds,
      ...packageFields
    } = updatePackageDto;

    if (packageFields.name !== undefined) {
      packageFields.name = normalizePackageName(packageFields.name);
      if (packageFields.name !== servicePackage.name) {
        await this.ensurePackageNameUnique(packageFields.name, id);
      }
    }

    const categoryIds = resolvePackageCategoryIds(updatePackageDto);
    if (categoryIds !== null) {
      await this.ensureCategoriesExist(categoryIds);
    }

    const services = serviceIds !== undefined
      ? await this.resolvePackageServices(serviceIds)
      : servicePackage.services;

    Object.assign(servicePackage, {
      ...packageFields,
      services,
    });

    if (categoryIds !== null) {
      servicePackage.categories = categoriesRefs(categoryIds);
    }

    if (updatePackageDto.tags === undefined && !servicePackage.tags) {
      servicePackage.tags = [];
    }

    await this.packageRepository.save(servicePackage);
    return this.loadWithCategories(id);
  }

  async remove(id: string): Promise<void> {
    const servicePackage = await this.findOneEntityForAdmin(id);
    const hasOrders = await this.packageHasOrderReferences(id);

    if (hasOrders) {
      servicePackage.deletedAt = new Date();
      await this.packageRepository.save(servicePackage);
      await this.dataSource.query(
        `DELETE FROM "recommendation" WHERE "packageId" = $1`,
        [id],
      );
      return;
    }

    await this.packageRepository.remove(servicePackage);
  }

  private async packageHasOrderReferences(packageId: string): Promise<boolean> {
    const orderItems = await this.orderItemRepository.count({
      where: { packageId },
    });
    return orderItems > 0;
  }

  async findAllPackagesForAdmin(query: GetAdminPackagesQueryDto): Promise<{
    data: AdminPackageListItem[];
    total: number;
    offset: number;
    limit: number;
  }> {
    const { offset = 0, limit = 20 } = query;
    const search = query.search?.trim();

    const qb = applyActivePackageFilter(
      this.packageRepository
        .createQueryBuilder('p')
        .leftJoinAndSelect('p.categories', 'c')
        .leftJoinAndSelect('p.services', 's'),
      'p',
    );

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

    const totalRaw = await qb.clone()
      .select('COUNT(DISTINCT p.id)', 'count')
      .getRawOne<{ count: string }>();
    const total = Number(totalRaw?.count ?? 0);

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
      where: { id, ...activePackageWhere() },
      relations: ['categories', 'services', 'services.category'],
    });

    if (!servicePackage) {
      throw new NotFoundException(`Пакет с ID ${id} не найден`);
    }

    servicePackage.services = filterActiveServices(servicePackage.services);

    const ordersCount = await this.orderItemRepository
      .createQueryBuilder('oi')
      .select('COUNT(DISTINCT oi."orderId")', 'count')
      .where('oi."packageId" = :packageId', { packageId: id })
      .getRawOne<{ count: string }>()
      .then((row) => Number(row?.count ?? 0));

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
      package: attachLegacyPackageCategory(servicePackage),
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
    const first = pkg.categories?.[0] ?? null;
    return {
      id: pkg.id,
      name: pkg.name,
      description: pkg.description,
      tags: pkg.tags ?? [],
      packageType: pkg.packageType,
      price: Number(pkg.price),
      giftEligible: pkg.giftEligible,
      image: pkg.image,
      imageOriginal: pkg.imageOriginal,
      isHidden: pkg.isHidden,
      categoryId: first?.id ?? null,
      category: first
        ? { id: first.id, name: first.name, slug: first.slug }
        : null,
      categoryIds: (pkg.categories ?? []).map((c) => c.id),
      categories: (pkg.categories ?? []).map((c) => ({ id: c.id, name: c.name, slug: c.slug })),
      services: filterActiveServices(pkg.services).map((service) => ({
        id: service.id,
        name: service.name,
      })),
      createdAt: pkg.createdAt,
      ordersCount,
    };
  }

  private async ensurePackageNameUnique(name: string, excludeId?: string): Promise<void> {
    const qb = this.packageRepository
      .createQueryBuilder('sp')
      .where('LOWER(sp.name) = LOWER(:name)', { name })
      .andWhere('sp."deletedAt" IS NULL');

    if (excludeId) {
      qb.andWhere('sp.id != :excludeId', { excludeId });
    }

    const conflict = await qb.getOne();
    if (conflict) {
      throw new ConflictException('Пакет с таким названием уже существует');
    }
  }

  private async ensureCategoriesExist(categoryIds: string[]): Promise<void> {
    if (!categoryIds.length) return;
    const found = await this.categoryRepository.find({ where: { id: In(categoryIds) } });
    const foundIds = new Set(found.map((c) => c.id));
    const missing = categoryIds.filter((id) => !foundIds.has(id));
    if (missing.length > 0) {
      throw new NotFoundException(`Категория с ID ${missing[0]} не найдена`);
    }
  }

  private async resolvePackageServices(serviceIds?: string[]): Promise<Service[]> {
    if (!serviceIds || serviceIds.length === 0) {
      return [];
    }

    const services = await this.serviceRepository.find({
      where: {
        id: In(serviceIds),
        deletedAt: IsNull(),
      },
    });
    const serviceIdsSet = new Set(services.map((service) => service.id));
    const missingIds = serviceIds.filter((id) => !serviceIdsSet.has(id));

    if (missingIds.length > 0) {
      throw new NotFoundException(`Услуги с ID ${missingIds.join(', ')} не найдены`);
    }

    const invalidServiceIds = services
      .filter((service) => service.type === ServiceType.Contractor)
      .map((service) => service.id);

    if (invalidServiceIds.length > 0) {
      throw new ConflictException(
        `В пакет нельзя добавлять подрядчиков. Неверные ID: ${invalidServiceIds.join(', ')}`,
      );
    }

    return services;
  }

  async setVisibilityForAdmin(id: string, isHidden: boolean): Promise<ServicePackage> {
    const servicePackage = await this.findOneEntityForAdmin(id);
    servicePackage.isHidden = isHidden;
    return this.packageRepository.save(servicePackage);
  }

  private async findOneEntityForAdmin(id: string): Promise<ServicePackage> {
    const servicePackage = await this.packageRepository.findOne({
      where: { id, ...activePackageWhere() },
      relations: ['categories'],
    });

    if (!servicePackage) {
      throw new NotFoundException(`Пакет с ID ${id} не найден`);
    }

    return servicePackage;
  }

}
