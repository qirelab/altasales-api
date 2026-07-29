import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, DataSource, In, IsNull, Repository } from 'typeorm';
import { UsersService } from '../users/users.service';
import { Category } from '../categories/entities/category.entity';
import { Order } from '../orders/entities/order.entity';
import { OrderItem } from '../orders/entities/order-item.entity';
import { OrderStatus } from '../orders/entities/order-status.enum';
import { ServicePackage } from '../packages/entities/package.entity';
import { User } from '../users/entities/user.entity';
import { UserRole } from '../users/entities/user-role.enum';
import { ExpertProfile } from '../experts/entities/expert-profile.entity';
import { applyPublicPackageFilter } from '../packages/package-visibility';
import { CreateServiceDto } from './dto/create-service.dto';
import { CreateAdminContractorDto } from './dto/create-admin-contractor.dto';
import { GetAdminContractorsQueryDto } from './dto/get-admin-contractors-query.dto';
import { GetAdminServicesQueryDto } from './dto/get-admin-services-query.dto';
import { UpdateAdminContractorDto } from './dto/update-admin-contractor.dto';
import { UpdateServiceDto } from './dto/update-service.dto';
import { GetServicesQueryDto } from './dto/get-services-query.dto';
import { Service } from './entities/service.entity';
import { ServiceType } from './entities/service-type.enum';
import {
  activeServiceWhere,
  applyActiveServiceFilter,
  applyPublicServiceFilter,
  publicServiceWhere,
} from './service-visibility';

const SALES_DASHBOARD_CATEGORY_SLUG = 'ai-analiz-prodazh';

@Injectable()
export class ServicesService {
  constructor(
    @InjectRepository(Service)
    private readonly serviceRepository: Repository<Service>,
    @InjectRepository(ServicePackage)
    private readonly packageRepository: Repository<ServicePackage>,
    @InjectRepository(Category)
    private readonly categoryRepository: Repository<Category>,
    @InjectRepository(Order)
    private readonly orderRepository: Repository<Order>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(ExpertProfile)
    private readonly expertProfileRepository: Repository<ExpertProfile>,
    @InjectRepository(OrderItem)
    private readonly orderItemRepository: Repository<OrderItem>,
    private readonly dataSource: DataSource,
    private readonly usersService: UsersService,
  ) {}

  async create(createServiceDto: CreateServiceDto): Promise<Service> {
    if (createServiceDto.categoryId) {
      await this.ensureCategoryExists(createServiceDto.categoryId);
    }

    const service = this.serviceRepository.create({
      ...createServiceDto,
      skills: createServiceDto.skills ?? [],
    });
    return await this.serviceRepository.save(service);
  }

  async findAll(query: GetServicesQueryDto): Promise<{
    packages: ServicePackage[];
    services: Service[];
    categoryContent: {
      id: string;
      name: string;
      description: string | null;
      faqs: Array<{
        id: string;
        question: string;
        answer: string;
      }>;
    } | null;
  }> {
    const categoryIds = query.categoryIds ?? [];

    const qb = applyPublicServiceFilter(
      this.serviceRepository
        .createQueryBuilder('service')
        .leftJoinAndSelect(
          'service.category',
          'category',
          'category."isHidden" = false',
        ),
    );
    qb.andWhere('(service."categoryId" IS NULL OR category.id IS NOT NULL)');

    if (query.name?.trim()) {
      qb.andWhere('service.name ILIKE :name', {
        name: `%${query.name.trim()}%`,
      });
    }
    if (query.type) {
      qb.andWhere('service.type = :type', { type: query.type });
    }
    if (categoryIds.length > 0) {
      qb.andWhere('service."categoryId" IN (:...categoryIds)', { categoryIds });
    }
    if (query.skill) {
      qb.andWhere('service.skills::jsonb @> :skill::jsonb', {
        skill: JSON.stringify([query.skill]),
      });
    }
    if (query.dateOrder) {
      qb.orderBy(
        'service.createdAt',
        query.dateOrder === 'asc' ? 'ASC' : 'DESC',
      );
    }
    if (query.priceOrder) {
      if (query.dateOrder) {
        qb.addOrderBy(
          'service.price',
          query.priceOrder === 'asc' ? 'ASC' : 'DESC',
        );
      } else {
        qb.orderBy(
          'service.price',
          query.priceOrder === 'asc' ? 'ASC' : 'DESC',
        );
      }
    }

    const packageQb = applyPublicPackageFilter(
      this.packageRepository
        .createQueryBuilder('sp')
        .leftJoinAndSelect(
          'sp.categories',
          'category',
          'category."isHidden" = false',
        )
        .leftJoinAndSelect(
          'sp.services',
          's',
          's."deletedAt" IS NULL AND s."isHidden" = false',
        ),
      'sp',
    );
    packageQb.andWhere(`(
      NOT EXISTS (
        SELECT 1 FROM "package_categories" pc WHERE pc."packageId" = sp.id
      ) OR category.id IS NOT NULL
    )`);

    if (categoryIds.length > 0) {
      packageQb.andWhere(
        (sqb) => {
          const sub = sqb
            .subQuery()
            .select('pc."packageId"')
            .from('package_categories', 'pc')
            .innerJoin(
              Category,
              'fc',
              'fc.id = pc."categoryId" AND fc."isHidden" = false',
            )
            .where('pc."categoryId" IN (:...categoryIds)')
            .getQuery();
          return `sp.id IN ${sub}`;
        },
        { categoryIds },
      );
    }
    if (query.name?.trim()) {
      packageQb.andWhere('sp.name ILIKE :name', {
        name: `%${query.name.trim()}%`,
      });
    }
    if (query.dateOrder) {
      packageQb.orderBy(
        'sp.createdAt',
        query.dateOrder === 'asc' ? 'ASC' : 'DESC',
      );
    }
    if (query.priceOrder) {
      if (query.dateOrder) {
        packageQb.addOrderBy(
          'sp.price',
          query.priceOrder === 'asc' ? 'ASC' : 'DESC',
        );
      } else {
        packageQb.orderBy(
          'sp.price',
          query.priceOrder === 'asc' ? 'ASC' : 'DESC',
        );
      }
    }

    const [services, packages, categoryContent] = await Promise.all([
      qb.getMany(),
      query.type && query.type !== ServiceType.Service
        ? Promise.resolve([])
        : packageQb.getMany(),
      this.getCategoryContentForFilter(categoryIds),
    ]);

    return {
      packages,
      services,
      categoryContent,
    };
  }

  async findAllServicesForAdmin(query: GetAdminServicesQueryDto): Promise<{
    data: Array<{
      id: string;
      type: ServiceType;
      name: string;
      description: string;
      category: string;
      categoryId: string | null;
      price: number;
      image: string | null;
      imageOriginal: string | null;
      isHidden: boolean;
      skills: string[];
      createdAt: Date;
      userId: string | null;
      giftEligible: boolean;
      contractorRatePerHour: number | null;
      contractorExperienceYears: number | null;
      ordersCount: number;
    }>;
    total: number;
    offset: number;
    limit: number;
  }> {
    const { offset = 0, limit = 20 } = query;
    const search = query.search?.trim();

    const baseQb = applyActiveServiceFilter(
      this.serviceRepository
        .createQueryBuilder('s')
        .leftJoin('s.category', 'c')
        .where('s.type IN (:...types)', {
          types: [ServiceType.Service, ServiceType.Document],
        }),
      's',
    );

    if (search) {
      baseQb.andWhere(
        new Brackets((qb) => {
          qb.where('s.name ILIKE :search', { search: `%${search}%` })
            .orWhere('c.name ILIKE :search', { search: `%${search}%` })
            .orWhere('s.description ILIKE :search', { search: `%${search}%` });
        }),
      );
    }

    const total = await baseQb.getCount();

    const rows = await baseQb
      .clone()
      .leftJoin(OrderItem, 'oi', 'oi."serviceId" = s.id')
      .select('s.id', 'id')
      .addSelect('s.type', 'type')
      .addSelect('s.name', 'name')
      .addSelect('s.description', 'description')
      .addSelect('c.name', 'category')
      .addSelect('s."categoryId"', 'categoryId')
      .addSelect('s.price', 'price')
      .addSelect('s.image', 'image')
      .addSelect('s."imageOriginal"', 'imageOriginal')
      .addSelect('s."isHidden"', 'isHidden')
      .addSelect('s.skills', 'skills')
      .addSelect('s."giftEligible"', 'giftEligible')
      .addSelect('s."createdAt"', 'createdAt')
      .addSelect('s."userId"', 'userId')
      .addSelect('COUNT(oi.id)', 'ordersCount')
      .groupBy('s.id')
      .addGroupBy('c.name')
      .orderBy('s."createdAt"', 'DESC')
      .offset(offset)
      .limit(limit)
      .getRawMany<{
        id: string;
        type: string;
        name: string;
        description: string;
        category: string | null;
        categoryId: string | null;
        price: string;
        image: string | null;
        imageOriginal: string | null;
        isHidden: boolean;
        skills: string[] | string;
        createdAt: Date;
        userId: string | null;
        giftEligible: boolean;
        ordersCount: string;
      }>();

    return {
      data: rows.map((row) => ({
        id: row.id,
        type: row.type as ServiceType,
        name: row.name,
        description: row.description,
        category: row.category ?? '',
        categoryId: row.categoryId,
        price: Number(row.price),
        image: row.image,
        imageOriginal: row.imageOriginal,
        isHidden: row.isHidden,
        skills: Array.isArray(row.skills)
          ? row.skills
          : JSON.parse(row.skills ?? '[]'),
        createdAt: row.createdAt,
        userId: row.userId,
        giftEligible: row.giftEligible,
        contractorRatePerHour: null,
        contractorExperienceYears: null,
        ordersCount: Number(row.ordersCount),
      })),
      total,
      offset,
      limit,
    };
  }

  async getAllSkills(): Promise<string[]> {
    const services = await applyPublicServiceFilter(
      this.serviceRepository
        .createQueryBuilder('service')
        .leftJoin('service.category', 'category', 'category."isHidden" = false')
        .select('service.skills'),
    )
      .andWhere('(service."categoryId" IS NULL OR category.id IS NOT NULL)')
      .getMany();

    const skillsSet = new Set<string>();
    for (const service of services) {
      for (const skill of service.skills) {
        skillsSet.add(skill);
      }
    }
    return Array.from(skillsSet).sort();
  }

  async findOne(id: string): Promise<Service> {
    const service = await applyPublicServiceFilter(
      this.serviceRepository
        .createQueryBuilder('service')
        .leftJoinAndSelect(
          'service.category',
          'category',
          'category."isHidden" = false',
        ),
    )
      .where('service.id = :id', { id })
      .andWhere('(service."categoryId" IS NULL OR category.id IS NOT NULL)')
      .getOne();
    if (!service || service.isHidden) {
      throw new NotFoundException(`Услуга с ID ${id} не найдена`);
    }
    return service;
  }

  async findForSalesDashboard(): Promise<Service[]> {
    const category = await this.categoryRepository.findOne({
      where: { slug: SALES_DASHBOARD_CATEGORY_SLUG, isHidden: false },
    });
    if (!category) {
      return [];
    }
    return this.serviceRepository.find({
      where: { categoryId: category.id, ...publicServiceWhere() },
      order: { createdAt: 'ASC' },
    });
  }

  async update(
    id: string,
    updateServiceDto: UpdateServiceDto,
  ): Promise<Service> {
    if (updateServiceDto.categoryId) {
      await this.ensureCategoryExists(updateServiceDto.categoryId);
    }

    const service = await this.findOneEntityForAdmin(id);
    Object.assign(service, updateServiceDto);
    if ('categoryId' in updateServiceDto) {
      service.category = updateServiceDto.categoryId
        ? ({ id: updateServiceDto.categoryId } as Category)
        : null;
    }
    return await this.serviceRepository.save(service);
  }

  async remove(id: string): Promise<void> {
    const service = await this.findOneEntityForAdmin(id);

    if (await this.serviceHasOrderReferences(id)) {
      service.deletedAt = new Date();
      await this.serviceRepository.save(service);
      await Promise.all([
        this.dataSource.query(
          `DELETE FROM "package_services" WHERE "serviceId" = $1`,
          [id],
        ),
        this.dataSource.query(
          `DELETE FROM "recommendation" WHERE "serviceId" = $1`,
          [id],
        ),
      ]);
      return;
    }

    await this.serviceRepository.remove(service);
  }

  async setVisibilityForAdmin(id: string, isHidden: boolean): Promise<Service> {
    const service = await this.findOneEntityForAdmin(id);
    service.isHidden = isHidden;
    return this.serviceRepository.save(service);
  }

  private async serviceHasOrderReferences(serviceId: string): Promise<boolean> {
    const [directOrderItems, subItemRows] = await Promise.all([
      this.orderItemRepository.count({ where: { serviceId } }),
      this.dataSource.query<{ count: string }[]>(
        `SELECT COUNT(*)::text AS count FROM "order_item_sub_item" WHERE "serviceId" = $1`,
        [serviceId],
      ),
    ]);

    return directOrderItems > 0 || Number(subItemRows[0]?.count ?? 0) > 0;
  }

  private async findOneEntityForAdmin(id: string): Promise<Service> {
    const service = await this.serviceRepository.findOne({
      where: { id, ...activeServiceWhere() },
      relations: ['category'],
    });
    if (!service) {
      throw new NotFoundException(`Услуга с ID ${id} не найдена`);
    }
    return service;
  }

  async createContractor(dto: CreateAdminContractorDto): Promise<Service> {
    const user = await this.userRepository.findOne({
      where: { id: dto.userId },
    });
    if (!user) {
      throw new NotFoundException(`Пользователь с ID ${dto.userId} не найден`);
    }

    const duplicateByUser = await this.serviceRepository.findOne({
      where: {
        type: ServiceType.Contractor,
        userId: dto.userId,
        ...activeServiceWhere(),
      },
    });
    if (duplicateByUser) {
      throw new ConflictException(
        'Для этого пользователя уже создан подрядчик',
      );
    }

    const expertCategoryId = await this.resolveExpertCategoryId();

    const contractor = this.serviceRepository.create({
      type: ServiceType.Contractor,
      name: dto.name,
      description: dto.description,
      categoryId: expertCategoryId,
      price: dto.ratePerHour,
      skills: dto.skills,
      image: dto.image ?? null,
      imageOriginal: dto.imageOriginal ?? null,
      userId: dto.userId,
      contractorRatePerHour: dto.ratePerHour,
      contractorExperienceYears: dto.experienceYears,
    });

    if (user.role !== UserRole.EXPERT) {
      user.role = UserRole.EXPERT;
      await this.userRepository.save(user);
    }

    return this.serviceRepository.save(contractor);
  }

  async findAllContractorsForAdmin(
    query: GetAdminContractorsQueryDto,
  ): Promise<{
    data: Array<Service & { ordersCount: number }>;
    total: number;
    offset: number;
    limit: number;
  }> {
    const { offset = 0, limit = 20 } = query;
    const search = query.search?.trim();
    const qb = applyActiveServiceFilter(
      this.serviceRepository
        .createQueryBuilder('service')
        .leftJoinAndSelect('service.user', 'u')
        .leftJoinAndSelect('service.category', 'category')
        .where('service.type = :type', { type: ServiceType.Contractor }),
    );

    if (search) {
      qb.andWhere(
        new Brackets((subQb) => {
          subQb
            .where('u.name ILIKE :search', { search: `%${search}%` })
            .orWhere('u."lastName" ILIKE :search', { search: `%${search}%` })
            .orWhere(`CONCAT(u.name, ' ', u."lastName") ILIKE :search`, {
              search: `%${search}%`,
            })
            .orWhere('u.email ILIKE :search', { search: `%${search}%` })
            .orWhere('u."phoneNumber" ILIKE :search', { search: `%${search}%` })
            .orWhere('category.name ILIKE :search', { search: `%${search}%` })
            .orWhere('service.skills::jsonb @> :skill::jsonb', {
              skill: JSON.stringify([search]),
            });
        }),
      );
    }

    const total = await qb.clone().getCount();

    const { entities, raw } = await qb
      .addSelect(
        (subQb) =>
          subQb
            .select('COUNT(oi.id)')
            .from(OrderItem, 'oi')
            .where('oi."serviceId" = service.id'),
        'ordersCount',
      )
      .orderBy('service.createdAt', 'DESC')
      .offset(offset)
      .limit(limit)
      .getRawAndEntities();

    const data = entities.map((service, index) => ({
      ...service,
      ordersCount: Number(raw[index]?.ordersCount ?? 0),
    }));

    return { data, total, offset, limit };
  }

  async findOneContractorForAdmin(id: string): Promise<{
    contractor: Service;
    stats: {
      totalProjects: number;
      activeOrders: number;
      totalIncome: number;
    };
    orders: Array<{
      id: string;
      hours: number;
      createdAt: Date;
      amount: number;
      status: string;
    }>;
  }> {
    const contractor = await this.findOneContractorEntityForAdmin(id);

    const aggregateRaw = await this.orderRepository
      .createQueryBuilder('o')
      .leftJoin('o.item', 'item')
      .select('COUNT(o.id)', 'totalProjects')
      .addSelect(
        `SUM(CASE WHEN o.status IN (:...activeStatuses) THEN 1 ELSE 0 END)`,
        'activeOrders',
      )
      .addSelect(
        `COALESCE(SUM(CASE WHEN o.status = :completedStatus THEN o.amount ELSE 0 END), 0)`,
        'totalIncome',
      )
      .where('item."serviceId" = :contractorId', { contractorId: id })
      .setParameter('activeStatuses', [
        OrderStatus.PendingPayment,
        OrderStatus.Planned,
        OrderStatus.InProgress,
      ])
      .setParameter('completedStatus', OrderStatus.Completed)
      .getRawOne<{
        totalProjects: string | null;
        activeOrders: string | null;
        totalIncome: string | null;
      }>();

    const ordersRaw = await this.orderRepository
      .createQueryBuilder('o')
      .leftJoin('o.item', 'item')
      .select('o.id', 'id')
      .addSelect('COALESCE(item.hours, 0)', 'hours')
      .addSelect('o."createdAt"', 'createdAt')
      .addSelect('o.amount', 'amount')
      .addSelect('o.status', 'status')
      .where('item."serviceId" = :contractorId', { contractorId: id })
      .orderBy('o."createdAt"', 'DESC')
      .getRawMany<{
        id: string;
        hours: string;
        createdAt: Date;
        amount: string;
        status: string;
      }>();

    return {
      contractor,
      stats: {
        totalProjects: Number(aggregateRaw?.totalProjects ?? 0),
        activeOrders: Number(aggregateRaw?.activeOrders ?? 0),
        totalIncome: Number(aggregateRaw?.totalIncome ?? 0),
      },
      orders: ordersRaw.map((order) => ({
        id: order.id,
        hours: Number(order.hours),
        createdAt: order.createdAt,
        amount: Number(order.amount),
        status: order.status,
      })),
    };
  }

  async findExpertProfile(userId: string): Promise<{
    contractor: Service & { user: User | null; category?: Category | null };
    stats: {
      totalProjects: number;
      activeOrders: number;
      totalIncome: number;
    };
    orders: Array<{
      id: string;
      hours: number;
      createdAt: Date;
      amount: number;
      status: string;
    }>;
  }> {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user || user.role !== UserRole.EXPERT) {
      throw new NotFoundException('Профиль эксперта не найден');
    }

    const [contractor, expertProfile] = await Promise.all([
      this.serviceRepository.findOne({
        where: { type: ServiceType.Contractor, userId },
        relations: ['user', 'category'],
      }),
      this.expertProfileRepository.findOne({ where: { userId } }),
    ]);

    const contractorView =
      contractor ?? this.buildExpertCabinetContractorView(user, expertProfile);

    const expertOrdersFilter = new Brackets((qb) => {
      qb.where('item."executorUserId" = :userId', { userId }).orWhere(
        'service.type = :contractorType AND service."userId" = :userId',
        {
          contractorType: ServiceType.Contractor,
          userId,
        },
      );
    });

    const aggregateRaw = await this.orderRepository
      .createQueryBuilder('o')
      .innerJoin('o.item', 'item')
      .leftJoin('item.service', 'service')
      .select('COUNT(DISTINCT o.id)', 'totalProjects')
      .addSelect(
        `COUNT(DISTINCT CASE WHEN o.status IN (:...activeStatuses) THEN o.id END)`,
        'activeOrders',
      )
      .addSelect(
        `COALESCE(SUM(CASE WHEN o.status = :completedStatus THEN item.amount ELSE 0 END), 0)`,
        'totalIncome',
      )
      .where(expertOrdersFilter)
      .setParameter('activeStatuses', [
        OrderStatus.PendingPayment,
        OrderStatus.Planned,
        OrderStatus.InProgress,
      ])
      .setParameter('completedStatus', OrderStatus.Completed)
      .getRawOne<{
        totalProjects: string | null;
        activeOrders: string | null;
        totalIncome: string | null;
      }>();

    const ordersRaw = await this.orderRepository
      .createQueryBuilder('o')
      .innerJoin('o.item', 'item')
      .leftJoin('item.service', 'service')
      .select('o.id', 'id')
      .addSelect('COALESCE(item.hours, 0)', 'hours')
      .addSelect('o."createdAt"', 'createdAt')
      .addSelect('item.amount', 'amount')
      .addSelect('o.status', 'status')
      .where(expertOrdersFilter)
      .orderBy('o."createdAt"', 'DESC')
      .getRawMany<{
        id: string;
        hours: string;
        createdAt: Date;
        amount: string;
        status: string;
      }>();

    return {
      contractor: contractorView,
      stats: {
        totalProjects: Number(aggregateRaw?.totalProjects ?? 0),
        activeOrders: Number(aggregateRaw?.activeOrders ?? 0),
        totalIncome: Number(aggregateRaw?.totalIncome ?? 0),
      },
      orders: ordersRaw.map((order) => ({
        id: order.id,
        hours: Number(order.hours),
        createdAt: order.createdAt,
        amount: Number(order.amount),
        status: order.status,
      })),
    };
  }

  private buildExpertCabinetContractorView(
    user: User,
    expertProfile: ExpertProfile | null,
  ): Service & { user: User | null } {
    const displayName =
      expertProfile?.displayName?.trim() ||
      `${user.name} ${user.lastName}`.trim() ||
      user.name;

    return {
      id: user.id,
      type: ServiceType.Contractor,
      name: displayName,
      description: expertProfile?.description ?? '',
      categoryId: null,
      category: null,
      price: 0,
      image: expertProfile?.image ?? null,
      imageOriginal: expertProfile?.imageOriginal ?? null,
      externalUrl: null,
      skills: expertProfile?.skills ?? [],
      contractorRatePerHour: null,
      contractorExperienceYears: expertProfile?.experienceYears ?? null,
      userId: user.id,
      user,
      giftEligible: false,
      isHidden: false,
      deletedAt: null,
      createdAt: user.createdAt,
      packages: [],
    } as Service & { user: User | null };
  }

  async findOneServiceForAdmin(id: string): Promise<{
    service: {
      id: string;
      type: ServiceType;
      name: string;
      description: string;
      category: string;
      price: number;
      image: string | null;
      skills: string[];
      giftEligible: boolean;
      isHidden: boolean;
      createdAt: Date;
    };
    stats: {
      totalProjects: number;
      activeOrders: number;
      totalIncome: number;
    };
    orders: Array<{
      id: string;
      positions: number;
      createdAt: Date;
      amount: number;
      status: string;
    }>;
  }> {
    const service = await this.serviceRepository.findOne({
      where: {
        id,
        type: In([ServiceType.Service, ServiceType.Document]),
        deletedAt: IsNull(),
      },
      relations: ['category'],
    });
    if (!service) {
      throw new NotFoundException(`Услуга с ID ${id} не найдена`);
    }

    const aggregateRaw = await this.orderRepository
      .createQueryBuilder('o')
      .innerJoin('o.item', 'item', 'item."serviceId" = :serviceId', {
        serviceId: id,
      })
      .select('COUNT(DISTINCT o.id)', 'totalProjects')
      .addSelect(
        `SUM(CASE WHEN o.status IN (:...activeStatuses) THEN 1 ELSE 0 END)`,
        'activeOrders',
      )
      .addSelect(
        `COALESCE(SUM(CASE WHEN o.status = :completedStatus THEN o.amount ELSE 0 END), 0)`,
        'totalIncome',
      )
      .setParameter('activeStatuses', [
        OrderStatus.PendingPayment,
        OrderStatus.Planned,
        OrderStatus.InProgress,
      ])
      .setParameter('completedStatus', OrderStatus.Completed)
      .getRawOne<{
        totalProjects: string | null;
        activeOrders: string | null;
        totalIncome: string | null;
      }>();

    const ordersRaw = await this.orderRepository
      .createQueryBuilder('o')
      .innerJoin('o.item', 'item', 'item."serviceId" = :serviceId', {
        serviceId: id,
      })
      .select('o.id', 'id')
      .addSelect('1', 'positions')
      .addSelect('o."createdAt"', 'createdAt')
      .addSelect('o.amount', 'amount')
      .addSelect('o.status', 'status')
      .orderBy('o."createdAt"', 'DESC')
      .getRawMany<{
        id: string;
        positions: string;
        createdAt: Date;
        amount: string;
        status: string;
      }>();

    return {
      service: {
        id: service.id,
        type: service.type,
        name: service.name,
        description: service.description,
        category: service.category?.name ?? '',
        price: Number(service.price),
        image: service.image,
        skills: service.skills,
        giftEligible: service.giftEligible,
        isHidden: service.isHidden,
        createdAt: service.createdAt,
      },
      stats: {
        totalProjects: Number(aggregateRaw?.totalProjects ?? 0),
        activeOrders: Number(aggregateRaw?.activeOrders ?? 0),
        totalIncome: Number(aggregateRaw?.totalIncome ?? 0),
      },
      orders: ordersRaw.map((order) => ({
        id: order.id,
        positions: Number(order.positions),
        createdAt: order.createdAt,
        amount: Number(order.amount),
        status: order.status,
      })),
    };
  }

  async updateContractorForAdmin(
    id: string,
    dto: UpdateAdminContractorDto,
  ): Promise<Service> {
    const contractor = await this.findOneContractorEntityForAdmin(id);
    if (dto.name !== undefined) contractor.name = dto.name;
    if (dto.description !== undefined) contractor.description = dto.description;
    if (dto.image !== undefined) contractor.image = dto.image ?? null;
    if (dto.imageOriginal !== undefined)
      contractor.imageOriginal = dto.imageOriginal ?? null;
    if (dto.ratePerHour !== undefined) {
      contractor.contractorRatePerHour = dto.ratePerHour;
      contractor.price = dto.ratePerHour;
    }
    if (dto.experienceYears !== undefined)
      contractor.contractorExperienceYears = dto.experienceYears;
    if (dto.skills !== undefined) contractor.skills = dto.skills;
    if (dto.userId !== undefined && dto.userId !== contractor.userId) {
      const user = await this.userRepository.findOne({
        where: { id: dto.userId },
      });
      if (!user) {
        throw new NotFoundException(
          `Пользователь с ID ${dto.userId} не найден`,
        );
      }

      const duplicateByUser = await this.serviceRepository.findOne({
        where: {
          type: ServiceType.Contractor,
          userId: dto.userId,
          ...activeServiceWhere(),
        },
      });
      if (duplicateByUser) {
        throw new ConflictException(
          'Для этого пользователя уже создан подрядчик',
        );
      }

      if (user.role !== UserRole.EXPERT) {
        user.role = UserRole.EXPERT;
        await this.userRepository.save(user);
      }

      contractor.userId = dto.userId;
    }
    contractor.type = ServiceType.Contractor;
    return this.serviceRepository.save(contractor);
  }

  async removeContractorForAdmin(id: string): Promise<void> {
    const contractor = await this.findOneContractorEntityForAdmin(id);
    const userId = contractor.userId;

    if (await this.serviceHasOrderReferences(id)) {
      contractor.deletedAt = new Date();
      await this.serviceRepository.save(contractor);
      await this.dataSource.query(
        `DELETE FROM "recommendation" WHERE "serviceId" = $1`,
        [id],
      );
      return;
    }

    let firebaseUid: string | null = null;
    if (userId) {
      const user = await this.userRepository.findOne({ where: { id: userId } });
      firebaseUid = user?.firebaseUid ?? null;
    }

    await this.dataSource.transaction(async (manager) => {
      await manager.getRepository(Service).remove(contractor);
      if (userId) {
        await manager.delete(User, { id: userId });
      }
    });

    await this.usersService.removeFirebaseAuthUser(firebaseUid);
  }

  private async findOneContractorEntityForAdmin(id: string): Promise<Service> {
    const contractor = await this.serviceRepository.findOne({
      where: { id, type: ServiceType.Contractor, ...activeServiceWhere() },
      relations: ['user', 'category'],
    });
    if (!contractor) {
      throw new NotFoundException(`Подрядчик с ID ${id} не найден`);
    }
    return contractor;
  }

  private async ensureCategoryExists(categoryId: string): Promise<void> {
    const category = await this.categoryRepository.findOne({
      where: { id: categoryId },
    });
    if (!category) {
      throw new NotFoundException(`Категория с ID ${categoryId} не найдена`);
    }
  }

  private async resolveExpertCategoryId(): Promise<string> {
    const category = await this.categoryRepository.findOne({
      where: { name: 'Эксперты' },
    });
    if (!category) {
      throw new NotFoundException('Категория «Эксперты» не найдена');
    }
    return category.id;
  }

  private async getCategoryContentForFilter(categoryIds: string[]): Promise<{
    id: string;
    name: string;
    description: string | null;
    faqs: Array<{
      id: string;
      question: string;
      answer: string;
    }>;
  } | null> {
    if (categoryIds.length !== 1) {
      return null;
    }

    const [categoryId] = categoryIds;
    const category = await this.categoryRepository.findOne({
      where: { id: categoryId, isHidden: false },
      relations: ['faqs'],
    });

    if (!category) {
      throw new NotFoundException(`Категория с ID ${categoryId} не найдена`);
    }

    return {
      id: category.id,
      name: category.name,
      description: category.description,
      faqs: category.faqs.map((faq) => ({
        id: faq.id,
        question: faq.question,
        answer: faq.answer,
      })),
    };
  }
}
