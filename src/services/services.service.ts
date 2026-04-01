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
import { UpdateAdminContractorDto } from './dto/update-admin-contractor.dto';
import { UpdateServiceDto } from './dto/update-service.dto';
import { GetServicesQueryDto } from './dto/get-services-query.dto';
import { Service } from './entities/service.entity';
import { ServiceType } from './entities/service-type.enum';

@Injectable()
export class ServicesService {
  constructor(
    @InjectRepository(Service)
    private readonly serviceRepository: Repository<Service>,
    @InjectRepository(Order)
    private readonly orderRepository: Repository<Order>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) { }

  async create(createServiceDto: CreateServiceDto): Promise<Service> {
    const service = this.serviceRepository.create({
      ...createServiceDto,
      skills: createServiceDto.skills ?? [],
    });
    return await this.serviceRepository.save(service);
  }

  async findAll(query: GetServicesQueryDto): Promise<Service[]> {
    const qb = this.serviceRepository.createQueryBuilder('service');

    if (query.name?.trim()) {
      qb.andWhere('service.name ILIKE :name', {
        name: `%${query.name.trim()}%`,
      });
    }
    if (query.type) {
      qb.andWhere('service.type = :type', { type: query.type });
    }
    if (query.category) {
      qb.andWhere('service.category = :category', { category: query.category });
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

    return await qb.getMany();
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
    const service = await this.serviceRepository.findOne({ where: { id } });
    if (!service) {
      throw new NotFoundException(`Услуга с ID ${id} не найдена`);
    }
    return service;
  }

  async update(id: string, updateServiceDto: UpdateServiceDto): Promise<Service> {
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
      category: ServiceType.Contractor,
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
    data: Service[];
    total: number;
    offset: number;
    limit: number;
  }> {
    const { offset = 0, limit = 20 } = query;
    const search = query.search?.trim();
    const qb = this.serviceRepository
      .createQueryBuilder('service')
      .leftJoinAndSelect('service.user', 'user')
      .where('service.type = :type', { type: ServiceType.Contractor });

    if (search) {
      qb.andWhere(
        new Brackets((subQb) => {
          subQb
            .where('user.name ILIKE :search', { search: `%${search}%` })
            .orWhere('user."lastName" ILIKE :search', { search: `%${search}%` })
            .orWhere(`CONCAT(user.name, ' ', user."lastName") ILIKE :search`, {
              search: `%${search}%`,
            })
            .orWhere('user.email ILIKE :search', { search: `%${search}%` })
            .orWhere('user."phoneNumber" ILIKE :search', { search: `%${search}%` })
            .orWhere('service.skills::jsonb @> :skill::jsonb', { skill: JSON.stringify([search]) });
        }),
      );
    }

    const [data, total] = await qb
      .orderBy('service.createdAt', 'DESC')
      .offset(offset)
      .limit(limit)
      .getManyAndCount();

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
      positions: number;
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
      .setParameter('activeStatuses', [OrderStatus.PendingPayment, OrderStatus.InProgress])
      .getRawOne<{
        totalProjects: string | null;
        activeOrders: string | null;
        totalIncome: string | null;
      }>();

    const ordersRaw = await this.orderRepository
      .createQueryBuilder('o')
      .leftJoin('o.items', 'item')
      .select('o.id', 'id')
      .addSelect('COUNT(item.id)', 'positions')
      .addSelect('o."createdAt"', 'createdAt')
      .addSelect('o.amount', 'amount')
      .addSelect('o.status', 'status')
      .where('o."userId" = :userId', { userId })
      .groupBy('o.id')
      .addGroupBy('o."createdAt"')
      .addGroupBy('o.amount')
      .addGroupBy('o.status')
      .orderBy('o."createdAt"', 'DESC')
      .getRawMany<{
        id: string;
        positions: string;
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
        positions: Number(order.positions),
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
    });
    if (!service) {
      throw new NotFoundException(`Услуга с ID ${id} не найдена`);
    }

    const aggregateRaw = await this.orderRepository
      .createQueryBuilder('o')
      .innerJoin('o.items', 'item', 'item."serviceId" = :serviceId', { serviceId: id })
      .select('COUNT(DISTINCT o.id)', 'totalProjects')
      .addSelect(
        `SUM(CASE WHEN o.status IN (:...activeStatuses) THEN 1 ELSE 0 END)`,
        'activeOrders',
      )
      .addSelect('COALESCE(SUM(o.amount), 0)', 'totalIncome')
      .setParameter('activeStatuses', [OrderStatus.PendingPayment, OrderStatus.InProgress])
      .getRawOne<{
        totalProjects: string | null;
        activeOrders: string | null;
        totalIncome: string | null;
      }>();

    const ordersRaw = await this.orderRepository
      .createQueryBuilder('o')
      .innerJoin('o.items', 'item', 'item."serviceId" = :serviceId', { serviceId: id })
      .select('o.id', 'id')
      .addSelect('COUNT(item.id)', 'positions')
      .addSelect('o."createdAt"', 'createdAt')
      .addSelect('o.amount', 'amount')
      .addSelect('o.status', 'status')
      .groupBy('o.id')
      .addGroupBy('o."createdAt"')
      .addGroupBy('o.amount')
      .addGroupBy('o.status')
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
}
