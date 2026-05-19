import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, Repository } from 'typeorm';
import { Order } from '../orders/entities/order.entity';
import { OrderStatus } from '../orders/entities/order-status.enum';
import { User } from '../users/entities/user.entity';
import { UserRole } from '../users/entities/user-role.enum';
import { CreateServiceDto } from './dto/create-service.dto';
import { CreateAdminContractorDto } from './dto/create-admin-contractor.dto';
import { GetAdminContractorsQueryDto } from './dto/get-admin-contractors-query.dto';
import { GetAdminServicesQueryDto } from './dto/get-admin-services-query.dto';
import { UpdateAdminContractorDto } from './dto/update-admin-contractor.dto';
import { UpdateServiceDto } from './dto/update-service.dto';
import { GetServicesQueryDto } from './dto/get-services-query.dto';
import { Service } from './entities/service.entity';
import { ServiceType } from './entities/service-type.enum';
import { OrderItem } from '../orders/entities/order-item.entity';
import { Category } from '../categories/entities/category.entity';
import { ServicePackage } from '../packages/entities/package.entity';

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
  ) { }

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
    const qb = this.serviceRepository
      .createQueryBuilder('service')
      .leftJoinAndSelect('service.category', 'category');

    if (query.name?.trim()) {
      qb.andWhere('service.name ILIKE :name', {
        name: `%${query.name.trim()}%`,
      });
    }
    if (query.type) {
      qb.andWhere('service.type = :type', { type: query.type });
    }
    if (query.categoryId) {
      qb.andWhere('service."categoryId" = :categoryId', { categoryId: query.categoryId });
    }
    if (query.skill) {
      qb.andWhere('service.skills::jsonb @> :skill::jsonb', { skill: JSON.stringify([query.skill]) });
    }
    if (query.dateOrder) {
      qb.orderBy('service.createdAt', query.dateOrder === 'asc' ? 'ASC' : 'DESC');
    }
    if (query.priceOrder) {
      if (query.dateOrder) {
        qb.addOrderBy('service.price', query.priceOrder === 'asc' ? 'ASC' : 'DESC');
      } else {
        qb.orderBy('service.price', query.priceOrder === 'asc' ? 'ASC' : 'DESC');
      }
    }

    const packageQb = this.packageRepository
      .createQueryBuilder('sp')
      .leftJoinAndSelect('sp.category', 'category');

    if (query.categoryId) {
      packageQb.andWhere('sp."categoryId" = :categoryId', { categoryId: query.categoryId });
    }
    if (query.name?.trim()) {
      packageQb.andWhere('sp.name ILIKE :name', {
        name: `%${query.name.trim()}%`,
      });
    }
    if (query.dateOrder) {
      packageQb.orderBy('sp.createdAt', query.dateOrder === 'asc' ? 'ASC' : 'DESC');
    }
    if (query.priceOrder) {
      if (query.dateOrder) {
        packageQb.addOrderBy('sp.price', query.priceOrder === 'asc' ? 'ASC' : 'DESC');
      } else {
        packageQb.orderBy('sp.price', query.priceOrder === 'asc' ? 'ASC' : 'DESC');
      }
    }

    const [services, packages, categoryContent] = await Promise.all([
      qb.getMany(),
      query.type && query.type !== ServiceType.Service ? Promise.resolve([]) : packageQb.getMany(),
      this.getCategoryContentForFilter(query.categoryId),
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
      price: number;
      image: string | null;
      skills: string[];
      createdAt: Date;
      userId: string | null;
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

    const baseQb = this.serviceRepository
      .createQueryBuilder('s')
      .leftJoin('s.category', 'c')
      .where('s.type = :type', { type: ServiceType.Service });

    if (search) {
      baseQb.andWhere(
        new Brackets((qb) => {
          qb
            .where('s.name ILIKE :search', { search: `%${search}%` })
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
      .addSelect('s.price', 'price')
      .addSelect('s.image', 'image')
      .addSelect('s.skills', 'skills')
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
        price: string;
        image: string | null;
        skills: string[] | string;
        createdAt: Date;
        userId: string | null;
        ordersCount: string;
      }>();

    return {
      data: rows.map((row) => ({
        id: row.id,
        type: row.type as ServiceType,
        name: row.name,
        description: row.description,
        category: row.category ?? '',
        price: Number(row.price),
        image: row.image,
        skills: Array.isArray(row.skills) ? row.skills : JSON.parse(row.skills ?? '[]'),
        createdAt: row.createdAt,
        userId: row.userId,
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
    const services = await this.serviceRepository
      .createQueryBuilder('service')
      .select('service.skills')
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
    const service = await this.serviceRepository.findOne({ where: { id }, relations: ['category'] });
    if (!service) {
      throw new NotFoundException(`Услуга с ID ${id} не найдена`);
    }
    return service;
  }

  async update(id: string, updateServiceDto: UpdateServiceDto): Promise<Service> {
    if (updateServiceDto.categoryId) {
      await this.ensureCategoryExists(updateServiceDto.categoryId);
    }

    const service = await this.findOne(id);
    Object.assign(service, updateServiceDto);
    return await this.serviceRepository.save(service);
  }

  async remove(id: string): Promise<void> {
    const service = await this.findOne(id);
    await this.serviceRepository.remove(service);
  }

  async createContractor(dto: CreateAdminContractorDto): Promise<Service> {
    const user = await this.userRepository.findOne({ where: { id: dto.userId } });
    if (!user) {
      throw new NotFoundException(`Пользователь с ID ${dto.userId} не найден`);
    }

    const duplicateByUser = await this.serviceRepository.findOne({
      where: { type: ServiceType.Contractor, userId: dto.userId },
    });
    if (duplicateByUser) {
      throw new ConflictException('Для этого пользователя уже создан подрядчик');
    }

    const contractor = this.serviceRepository.create({
      type: ServiceType.Contractor,
      name: 'Подрядчик',
      description: dto.description,
      categoryId: null,
      price: dto.ratePerHour,
      skills: dto.skills,
      image: dto.image ?? null,
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

  async findAllContractorsForAdmin(query: GetAdminContractorsQueryDto): Promise<{
    data: Array<Service & { ordersCount: number }>;
    total: number;
    offset: number;
    limit: number;
  }> {
    const { offset = 0, limit = 20 } = query;
    const search = query.search?.trim();
    const qb = this.serviceRepository
      .createQueryBuilder('service')
      .leftJoinAndSelect('service.user', 'u')
      .where('service.type = :type', { type: ServiceType.Contractor });

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
            .orWhere('service.skills::jsonb @> :skill::jsonb', { skill: JSON.stringify([search]) });
        }),
      );
    }

    const total = await qb.clone().getCount();

    const { entities, raw } = await qb
      .addSelect(
        (subQb) => subQb
          .select('COUNT(ord.id)')
          .from(Order, 'ord')
          .where('ord."userId" = service."userId"'),
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

    const userId = contractor.userId;
    if (!userId) {
      return {
        contractor,
        stats: {
          totalProjects: 0,
          activeOrders: 0,
          totalIncome: 0,
        },
        orders: [],
      };
    }

    const aggregateRaw = await this.orderRepository
      .createQueryBuilder('o')
      .select('COUNT(o.id)', 'totalProjects')
      .addSelect(
        `SUM(CASE WHEN o.status IN (:...activeStatuses) THEN 1 ELSE 0 END)`,
        'activeOrders',
      )
      .addSelect('COALESCE(SUM(o.amount), 0)', 'totalIncome')
      .where('o."userId" = :userId', { userId })
      .setParameter('activeStatuses', [
        OrderStatus.PendingPayment,
        OrderStatus.Planned,
        OrderStatus.InProgress,
      ])
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
      .where('o."userId" = :userId', { userId })
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
    const contractor = await this.serviceRepository.findOne({
      where: { type: ServiceType.Contractor, userId },
      relations: ['user'],
    });

    if (!contractor) {
      throw new NotFoundException('Профиль эксперта не найден');
    }

    const aggregateRaw = await this.orderRepository
      .createQueryBuilder('o')
      .innerJoin('o.item', 'item')
      .innerJoin('item.service', 'service')
      .select('COUNT(DISTINCT o.id)', 'totalProjects')
      .addSelect(
        `COUNT(DISTINCT CASE WHEN o.status IN (:...activeStatuses) THEN o.id END)`,
        'activeOrders',
      )
      .addSelect('COALESCE(SUM(item.amount), 0)', 'totalIncome')
      .where('service.type = :contractorType', { contractorType: ServiceType.Contractor })
      .andWhere('service."userId" = :userId', { userId })
      .setParameter('activeStatuses', [
        OrderStatus.PendingPayment,
        OrderStatus.Planned,
        OrderStatus.InProgress,
      ])
      .getRawOne<{
        totalProjects: string | null;
        activeOrders: string | null;
        totalIncome: string | null;
      }>();

    const ordersRaw = await this.orderRepository
      .createQueryBuilder('o')
      .innerJoin('o.item', 'item')
      .innerJoin('item.service', 'service')
      .select('o.id', 'id')
      .addSelect('COALESCE(item.hours, 0)', 'hours')
      .addSelect('o."createdAt"', 'createdAt')
      .addSelect('item.amount', 'amount')
      .addSelect('o.status', 'status')
      .where('service.type = :contractorType', { contractorType: ServiceType.Contractor })
      .andWhere('service."userId" = :userId', { userId })
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

  async findOneServiceForAdmin(id: string): Promise<{
    service: Service;
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
      where: { id, type: ServiceType.Service },
      relations: ['category'],
    });
    if (!service) {
      throw new NotFoundException(`Услуга с ID ${id} не найдена`);
    }

    const aggregateRaw = await this.orderRepository
      .createQueryBuilder('o')
      .innerJoin('o.item', 'item', 'item."serviceId" = :serviceId', { serviceId: id })
      .select('COUNT(DISTINCT o.id)', 'totalProjects')
      .addSelect(
        `SUM(CASE WHEN o.status IN (:...activeStatuses) THEN 1 ELSE 0 END)`,
        'activeOrders',
      )
      .addSelect('COALESCE(SUM(o.amount), 0)', 'totalIncome')
      .setParameter('activeStatuses', [
        OrderStatus.PendingPayment,
        OrderStatus.Planned,
        OrderStatus.InProgress,
      ])
      .getRawOne<{
        totalProjects: string | null;
        activeOrders: string | null;
        totalIncome: string | null;
      }>();

    const ordersRaw = await this.orderRepository
      .createQueryBuilder('o')
      .innerJoin('o.item', 'item', 'item."serviceId" = :serviceId', { serviceId: id })
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
      service,
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

  async updateContractorForAdmin(id: string, dto: UpdateAdminContractorDto): Promise<Service> {
    const contractor = await this.findOneContractorEntityForAdmin(id);
    if (dto.description !== undefined) contractor.description = dto.description;
    if (dto.image !== undefined) contractor.image = dto.image ?? null;
    if (dto.ratePerHour !== undefined) {
      contractor.contractorRatePerHour = dto.ratePerHour;
      contractor.price = dto.ratePerHour;
    }
    if (dto.experienceYears !== undefined) contractor.contractorExperienceYears = dto.experienceYears;
    if (dto.skills !== undefined) contractor.skills = dto.skills;
    if (dto.userId !== undefined && dto.userId !== contractor.userId) {
      const user = await this.userRepository.findOne({ where: { id: dto.userId } });
      if (!user) {
        throw new NotFoundException(`Пользователь с ID ${dto.userId} не найден`);
      }

      const duplicateByUser = await this.serviceRepository.findOne({
        where: { type: ServiceType.Contractor, userId: dto.userId },
      });
      if (duplicateByUser) {
        throw new ConflictException('Для этого пользователя уже создан подрядчик');
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
    await this.serviceRepository.remove(contractor);
  }

  private async findOneContractorEntityForAdmin(id: string): Promise<Service> {
    const contractor = await this.serviceRepository.findOne({
      where: { id, type: ServiceType.Contractor },
      relations: ['user'],
    });
    if (!contractor) {
      throw new NotFoundException(`Подрядчик с ID ${id} не найден`);
    }
    return contractor;
  }

  private async ensureCategoryExists(categoryId: string): Promise<void> {
    const category = await this.categoryRepository.findOne({ where: { id: categoryId } });
    if (!category) {
      throw new NotFoundException(`Категория с ID ${categoryId} не найдена`);
    }
  }

  private async getCategoryContentForFilter(categoryId?: string): Promise<{
    id: string;
    name: string;
    description: string | null;
    faqs: Array<{
      id: string;
      question: string;
      answer: string;
    }>;
  } | null> {
    if (!categoryId) {
      return null;
    }

    const category = await this.categoryRepository.findOne({
      where: { id: categoryId },
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
