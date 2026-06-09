import {
  BadRequestException,
  ConflictException,
  Injectable,
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
import { OrderItem } from '../orders/entities/order-item.entity';
import { OrderItemSubItem } from '../orders/entities/order-item-sub-item.entity';
import { OrderStatus } from '../orders/entities/order-status.enum';
import { User } from '../users/entities/user.entity';
import { UserRole } from '../users/entities/user-role.enum';
import { AddExpertToGroupDto } from './dto/add-expert-to-group.dto';
import {
  CreateAdminExpertGroupDto,
  UpdateAdminExpertGroupDto,
} from './dto/create-admin-expert-group.dto';
import { ExpertGroupsQueryDto } from './dto/expert-groups-query.dto';
import { CreateGroupServiceDto, UpdateGroupServiceDto } from './dto/group-service.dto';
import {
  BulkUpdateGroupPricesDto,
  SingleUpdateGroupPriceDto,
  UpdateGroupPriceCellDto,
} from './dto/update-group-prices.dto';
import { ExpertPosition } from './entities/expert-position.entity';
import { ExpertPositionMember } from './entities/expert-position-member.entity';
import { ExpertPositionOffering } from './entities/expert-position-offering.entity';
import { ExpertServicePrice } from './entities/expert-service-price.entity';

const OFFERING_NAME_ORDER = ['Консультация', 'Аудит', 'Сопровождение'] as const;

function sortOfferingsByName<T extends { name: string }>(items: T[]): T[] {
  return [...items].sort(
    (a, b) => OFFERING_NAME_ORDER.indexOf(a.name as typeof OFFERING_NAME_ORDER[number])
      - OFFERING_NAME_ORDER.indexOf(b.name as typeof OFFERING_NAME_ORDER[number]),
  );
}

export interface ExpertPositionBase {
  id: string;
  name: string;
  description: string;
}

export interface ExpertPositionListItem extends ExpertPositionBase {
  executorsCount: number;
  offeringsCount: number;
  minPrice: number | null;
}

export interface ExpertExecutorOfferingPrice {
  offeringId: string;
  name: string;
  price: number;
}

export interface ExpertExecutorDto {
  id: string;
  name: string;
  lastName: string;
  experienceYears: number | null;
  offerings: ExpertExecutorOfferingPrice[];
}

export interface ExpertPositionDetailDto extends ExpertPositionBase {
  offerings: Array<{
    id: string;
    name: string;
    description: string | null;
  }>;
  executors: ExpertExecutorDto[];
}

export interface AdminExpertGroupPreviewMember {
  id: string;
  name: string;
  lastName: string;
}

export interface AdminExpertGroupsListItemDto {
  id: string;
  title: string;
  iconLabel: string | null;
  image: string | null;
  description: string;
  expertsCount: number;
  expertsPreview: AdminExpertGroupPreviewMember[];
  servicesCount: number;
  priceFrom: number | null;
  ordersCount: number;
}

export interface AdminExpertGroupDetailsDto {
  id: string;
  title: string;
  iconLabel: string | null;
  image: string | null;
  description: string;
  experts: Array<{
    id: string;
    name: string;
    lastName: string;
    email: string;
    phoneNumber: string;
  }>;
  services: Array<{
    id: string;
    name: string;
    description: string | null;
    defaultPrice: number;
  }>;
  prices: Record<string, Record<string, number | null>>;
}

export interface AvailableGroupExpertsDto {
  data: Array<{
    id: string;
    name: string;
    lastName: string;
    email: string;
    phoneNumber: string;
  }>;
  total: number;
  offset: number;
  limit: number;
}

export interface ExpertCheckoutResolveInput {
  positionId: string;
  executorUserId: string;
  offeringIds: string[];
}

export interface ExpertCheckoutResolveResult {
  positionId: string;
  executorUserId: string;
  offeringLines: Array<{ offeringId: string; unitPrice: number }>;
  amount: number;
}

@Injectable()
export class ExpertsService {
  constructor(
    @InjectRepository(ExpertPosition)
    private readonly positionRepository: Repository<ExpertPosition>,
    @InjectRepository(ExpertPositionMember)
    private readonly memberRepository: Repository<ExpertPositionMember>,
    @InjectRepository(ExpertPositionOffering)
    private readonly offeringRepository: Repository<ExpertPositionOffering>,
    @InjectRepository(ExpertServicePrice)
    private readonly expertServicePriceRepository: Repository<ExpertServicePrice>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(OrderItem)
    private readonly orderItemRepository: Repository<OrderItem>,
    @InjectRepository(OrderItemSubItem)
    private readonly orderItemSubItemRepository: Repository<OrderItemSubItem>,
    private readonly dataSource: DataSource,
  ) { }

  async findAllPositions(): Promise<ExpertPositionListItem[]> {
    const positions = await this.positionRepository.find({
      where: { deletedAt: IsNull() },
      order: { createdAt: 'ASC' },
      relations: ['offerings', 'members'],
    });

    const positionIds = positions.map((p) => p.id);
    const memberOfferings = positionIds.length > 0
      ? await this.expertServicePriceRepository
        .createQueryBuilder('esp')
        .innerJoin('esp.groupService', 'offering')
        .select(['esp.price AS price', 'offering."positionId" AS "positionId"'])
        .where('offering."positionId" IN (:...positionIds)', { positionIds })
        .andWhere('esp.price IS NOT NULL')
        .getRawMany<{ price: string; positionId: string }>()
      : [];

    const minPriceByPosition = new Map<string, number>();
    for (const row of memberOfferings) {
      const price = Number(row.price);
      if (!Number.isFinite(price) || price <= 0) continue;
      const current = minPriceByPosition.get(row.positionId);
      if (current === undefined || price < current) {
        minPriceByPosition.set(row.positionId, price);
      }
    }

    return positions.map((position) => ({
      id: position.id,
      name: position.name,
      description: position.description,
      executorsCount: position.members?.length ?? 0,
      offeringsCount: position.offerings?.length ?? 0,
      minPrice: minPriceByPosition.get(position.id) ?? null,
    }));
  }

  async findPositionById(id: string): Promise<ExpertPositionDetailDto> {
    const position = await this.positionRepository.findOne({
      where: { id, deletedAt: IsNull() },
      relations: ['offerings', 'members', 'members.user'],
    });
    if (!position) {
      throw new NotFoundException(`Expert position with id ${id} not found`);
    }

    const activeOfferings = (position.offerings ?? []).filter((offering) => !offering.deletedAt);
    const positionOfferings = sortOfferingsByName(activeOfferings);
    const offerings = positionOfferings.map((offering) => ({
      id: offering.id,
      name: offering.name,
      description: offering.description,
    }));

    const executors = await Promise.all(
      (position.members ?? [])
        .filter((member) => !member.deletedAt && Boolean(member.user))
        .map(async (member) => {
          const prices = await this.getMemberOfferingPrices(member.id, positionOfferings);
          if (member.user!.role !== UserRole.EXPERT) return null;
          return {
            id: member.user!.id,
            name: member.user!.name,
            lastName: member.user!.lastName,
            experienceYears: member.user!.experienceYears ?? null,
            offerings: prices,
          };
        }),
    );

    return {
      id: position.id,
      name: position.name,
      description: position.description,
      offerings,
      executors: executors.filter(Boolean) as ExpertExecutorDto[],
    };
  }

  async resolveCheckoutLines(input: ExpertCheckoutResolveInput): Promise<ExpertCheckoutResolveResult> {
    const uniqueOfferingIds = [...new Set(input.offeringIds)];
    if (uniqueOfferingIds.length !== input.offeringIds.length) {
      throw new BadRequestException('Duplicate offering IDs are not allowed');
    }

    const position = await this.positionRepository.findOne({
      where: { id: input.positionId, deletedAt: IsNull() },
      relations: ['offerings'],
    });
    if (!position) {
      throw new NotFoundException(`Expert position with id ${input.positionId} not found`);
    }

    const positionOfferings = (position.offerings ?? []).filter((offering) => !offering.deletedAt);
    const offerings = positionOfferings.filter((offering) => uniqueOfferingIds.includes(offering.id));
    if (offerings.length !== uniqueOfferingIds.length) {
      throw new BadRequestException('One or more offerings do not belong to the selected position');
    }

    const member = await this.memberRepository.findOne({
      where: {
        positionId: input.positionId,
        userId: input.executorUserId,
        deletedAt: IsNull(),
      },
      relations: ['user'],
    });
    if (!member?.user) {
      throw new ConflictException('Selected executor is not assigned to this position');
    }
    if (member.user.role !== UserRole.EXPERT) {
      throw new BadRequestException('Selected executor must have expert role');
    }

    const memberPrices = await this.expertServicePriceRepository.find({
      where: {
        expertId: input.executorUserId,
        groupServiceId: In(uniqueOfferingIds),
      },
    });
    const activePrices = memberPrices.filter((entry) => entry.price !== null);
    if (activePrices.length !== uniqueOfferingIds.length) {
      throw new BadRequestException('У исполнителя не заданы цены на выбранные услуги');
    }

    const offeringLines = activePrices.map((entry) => ({
      offeringId: entry.groupServiceId,
      unitPrice: Number(entry.price),
    }));
    const amount = offeringLines.reduce((sum, line) => sum + line.unitPrice, 0);
    if (amount <= 0) {
      throw new BadRequestException('Order amount must be greater than zero');
    }

    return {
      positionId: input.positionId,
      executorUserId: input.executorUserId,
      offeringLines,
      amount,
    };
  }

  private async getMemberOfferingPrices(
    memberId: string,
    positionOfferings: ExpertPositionOffering[],
  ): Promise<ExpertExecutorOfferingPrice[]> {
    const member = await this.memberRepository.findOne({
      where: { id: memberId, deletedAt: IsNull() },
    });
    if (!member) return [];
    const entries = await this.expertServicePriceRepository.find({
      where: {
        expertId: member.userId,
        groupServiceId: In(positionOfferings.map((offering) => offering.id)),
      },
    });
    const priceByOfferingId = new Map(
      entries
        .filter((entry) => entry.price !== null)
        .map((entry) => [entry.groupServiceId, Number(entry.price)]),
    );
    return sortOfferingsByName(positionOfferings)
      .filter((offering) => priceByOfferingId.has(offering.id))
      .map((offering) => ({
        offeringId: offering.id,
        name: offering.name,
        price: priceByOfferingId.get(offering.id)!,
      }));
  }

  async getAdminExpertGroups(query: ExpertGroupsQueryDto): Promise<{
    data: AdminExpertGroupsListItemDto[];
    total: number;
    offset: number;
    limit: number;
  }> {
    const { offset = 0, limit = 20 } = query;
    const search = query.search?.trim();

    const qb = this.positionRepository
      .createQueryBuilder('position')
      .where('position."deletedAt" IS NULL');

    if (search) {
      qb.andWhere('position.name ILIKE :search', { search: `%${search}%` });
    }

    const total = await qb.getCount();
    const groups = await qb
      .orderBy('position."createdAt"', 'DESC')
      .offset(offset)
      .limit(limit)
      .getMany();

    if (!groups.length) {
      return { data: [], total, offset, limit };
    }

    const groupIds = groups.map((group) => group.id);

    const expertsCountsRaw = await this.memberRepository
      .createQueryBuilder('member')
      .select('member."positionId"', 'positionId')
      .addSelect('COUNT(member.id)', 'count')
      .where('member."positionId" IN (:...groupIds)', { groupIds })
      .andWhere('member."deletedAt" IS NULL')
      .groupBy('member."positionId"')
      .getRawMany<{ positionId: string; count: string }>();

    const servicesCountsRaw = await this.offeringRepository
      .createQueryBuilder('service')
      .select('service."positionId"', 'positionId')
      .addSelect('COUNT(service.id)', 'count')
      .where('service."positionId" IN (:...groupIds)', { groupIds })
      .andWhere('service."deletedAt" IS NULL')
      .groupBy('service."positionId"')
      .getRawMany<{ positionId: string; count: string }>();

    const priceFromRaw = await this.expertServicePriceRepository
      .createQueryBuilder('price')
      .innerJoin(ExpertPositionOffering, 'service', 'service.id = price."groupServiceId"')
      .innerJoin(
        ExpertPositionMember,
        'member',
        'member."positionId" = service."positionId" AND member."userId" = price."expertId"',
      )
      .select('service."positionId"', 'positionId')
      .addSelect('MIN(price.price)', 'priceFrom')
      .where('service."positionId" IN (:...groupIds)', { groupIds })
      .andWhere('service."deletedAt" IS NULL')
      .andWhere('member."deletedAt" IS NULL')
      .andWhere('price.price IS NOT NULL')
      .groupBy('service."positionId"')
      .getRawMany<{ positionId: string; priceFrom: string | null }>();

    const ordersCountsRaw = await this.orderItemRepository
      .createQueryBuilder('item')
      .select('item."expertPositionId"', 'positionId')
      .addSelect('COUNT(item.id)', 'count')
      .where('item."expertPositionId" IN (:...groupIds)', { groupIds })
      .groupBy('item."expertPositionId"')
      .getRawMany<{ positionId: string; count: string }>();

    const previewMembers = await this.memberRepository
      .createQueryBuilder('member')
      .leftJoinAndSelect('member.user', 'user')
      .where('member."positionId" IN (:...groupIds)', { groupIds })
      .andWhere('member."deletedAt" IS NULL')
      .orderBy('member."positionId"')
      .addOrderBy('member."createdAt"', 'ASC')
      .getMany();
    const expertsPreviewByGroup = new Map<string, AdminExpertGroupPreviewMember[]>();
    for (const member of previewMembers) {
      if (!member.user || member.user.role !== UserRole.EXPERT) continue;
      const list = expertsPreviewByGroup.get(member.positionId) ?? [];
      if (list.length < 3) {
        list.push({
          id: member.user.id,
          name: member.user.name,
          lastName: member.user.lastName,
        });
        expertsPreviewByGroup.set(member.positionId, list);
      }
    }

    const expertsCountByGroup = new Map(expertsCountsRaw.map((row) => [row.positionId, Number(row.count)]));
    const servicesCountByGroup = new Map(servicesCountsRaw.map((row) => [row.positionId, Number(row.count)]));
    const priceFromByGroup = new Map(
      priceFromRaw.map((row) => [row.positionId, row.priceFrom === null ? null : Number(row.priceFrom)]),
    );
    const ordersCountByGroup = new Map(ordersCountsRaw.map((row) => [row.positionId, Number(row.count)]));

    return {
      data: groups.map((group) => ({
        id: group.id,
        title: group.name,
        iconLabel: group.iconLabel ?? null,
        image: group.image ?? null,
        description: group.description,
        expertsCount: expertsCountByGroup.get(group.id) ?? 0,
        expertsPreview: expertsPreviewByGroup.get(group.id) ?? [],
        servicesCount: servicesCountByGroup.get(group.id) ?? 0,
        priceFrom: priceFromByGroup.get(group.id) ?? null,
        ordersCount: ordersCountByGroup.get(group.id) ?? 0,
      })),
      total,
      offset,
      limit,
    };
  }

  async getAdminExpertGroupById(groupId: string): Promise<AdminExpertGroupDetailsDto> {
    const group = await this.findActiveGroupOrThrow(groupId);

    const [members, services] = await Promise.all([
      this.memberRepository.find({
        where: { positionId: groupId, deletedAt: IsNull() },
        relations: ['user'],
        order: { createdAt: 'ASC' },
      }),
      this.offeringRepository.find({
        where: { positionId: groupId, deletedAt: IsNull() },
        order: { name: 'ASC' },
      }),
    ]);

    const experts = members
      .filter((member) => member.user?.role === UserRole.EXPERT)
      .map((member) => ({
        id: member.user!.id,
        name: member.user!.name,
        lastName: member.user!.lastName,
        email: member.user!.email,
        phoneNumber: member.user!.phoneNumber,
      }));

    const matrix: Record<string, Record<string, number | null>> = {};
    experts.forEach((expert) => {
      matrix[expert.id] = {};
      services.forEach((service) => {
        matrix[expert.id][service.id] = null;
      });
    });

    if (experts.length && services.length) {
      const prices = await this.expertServicePriceRepository.find({
        where: {
          expertId: In(experts.map((expert) => expert.id)),
          groupServiceId: In(services.map((service) => service.id)),
        },
      });
      prices.forEach((entry) => {
        if (matrix[entry.expertId]) {
          matrix[entry.expertId][entry.groupServiceId] = entry.price === null ? null : Number(entry.price);
        }
      });
    }

    return {
      id: group.id,
      title: group.name,
      iconLabel: group.iconLabel ?? null,
      image: group.image ?? null,
      description: group.description,
      experts,
      services: services.map((service) => ({
        id: service.id,
        name: service.name,
        description: service.description,
        defaultPrice: Number(service.defaultPrice),
      })),
      prices: matrix,
    };
  }

  async createAdminExpertGroup(dto: CreateAdminExpertGroupDto): Promise<AdminExpertGroupDetailsDto> {
    const duplicate = await this.positionRepository.findOne({
      where: { name: dto.title.trim(), deletedAt: IsNull() },
    });
    if (duplicate) {
      throw new BadRequestException('Группа с таким названием уже существует');
    }

    const group = this.positionRepository.create({
      name: dto.title.trim(),
      description: dto.description.trim(),
      iconLabel: dto.iconLabel?.trim() || null,
      image: dto.image?.trim() || null,
    });
    const saved = await this.positionRepository.save(group);
    return this.getAdminExpertGroupById(saved.id);
  }

  async updateAdminExpertGroup(
    groupId: string,
    dto: UpdateAdminExpertGroupDto,
  ): Promise<AdminExpertGroupDetailsDto> {
    const group = await this.findActiveGroupOrThrow(groupId);

    if (dto.title !== undefined) {
      const title = dto.title.trim();
      const duplicate = await this.positionRepository.findOne({
        where: { name: title, deletedAt: IsNull() },
      });
      if (duplicate && duplicate.id !== group.id) {
        throw new BadRequestException('Группа с таким названием уже существует');
      }
      group.name = title;
    }
    if (dto.description !== undefined) group.description = dto.description.trim();
    if (dto.iconLabel !== undefined) group.iconLabel = dto.iconLabel?.trim() || null;
    if (dto.image !== undefined) group.image = dto.image?.trim() || null;

    await this.positionRepository.save(group);
    return this.getAdminExpertGroupById(group.id);
  }

  async removeAdminExpertGroup(groupId: string): Promise<void> {
    const group = await this.findActiveGroupOrThrow(groupId);
    const hasOrders = await this.orderItemRepository.exist({
      where: { expertPositionId: group.id },
    });
    if (hasOrders) {
      group.deletedAt = new Date();
      await this.positionRepository.save(group);
      return;
    }
    await this.positionRepository.remove(group);
  }

  async getAvailableExpertsForGroup(
    groupId: string,
    query: ExpertGroupsQueryDto,
  ): Promise<AvailableGroupExpertsDto> {
    await this.findActiveGroupOrThrow(groupId);
    const { offset = 0, limit = 20 } = query;
    const search = query.search?.trim();

    const qb = this.userRepository
      .createQueryBuilder('u')
      .where('u.role = :role', { role: UserRole.EXPERT })
      .andWhere(
        `NOT EXISTS (
          SELECT 1
          FROM "expert_position_member" m
          WHERE m."positionId" = :groupId
            AND m."userId" = u.id
            AND m."deletedAt" IS NULL
        )`,
        { groupId },
      );

    if (search) {
      qb.andWhere(
        new Brackets((subQb) => {
          subQb
            .where('u.name ILIKE :search', { search: `%${search}%` })
            .orWhere('u."lastName" ILIKE :search', { search: `%${search}%` })
            .orWhere(`CONCAT(u.name, ' ', u."lastName") ILIKE :search`, { search: `%${search}%` })
            .orWhere('u.email ILIKE :search', { search: `%${search}%` });
        }),
      );
    }

    const total = await qb.getCount();
    const users = await qb
      .orderBy('u."createdAt"', 'DESC')
      .offset(offset)
      .limit(limit)
      .getMany();

    return {
      data: users.map((user) => ({
        id: user.id,
        name: user.name,
        lastName: user.lastName,
        email: user.email,
        phoneNumber: user.phoneNumber,
      })),
      total,
      offset,
      limit,
    };
  }

  async getAllExpertUsers(query: ExpertGroupsQueryDto): Promise<AvailableGroupExpertsDto> {
    const { offset = 0, limit = 20 } = query;
    const search = query.search?.trim();

    const qb = this.userRepository
      .createQueryBuilder('u')
      .where('u.role = :role', { role: UserRole.EXPERT });

    if (search) {
      qb.andWhere(
        new Brackets((subQb) => {
          subQb
            .where('u.name ILIKE :search', { search: `%${search}%` })
            .orWhere('u."lastName" ILIKE :search', { search: `%${search}%` })
            .orWhere(`CONCAT(u.name, ' ', u."lastName") ILIKE :search`, { search: `%${search}%` })
            .orWhere('u.email ILIKE :search', { search: `%${search}%` });
        }),
      );
    }

    const total = await qb.getCount();
    const users = await qb
      .orderBy('u."createdAt"', 'DESC')
      .offset(offset)
      .limit(limit)
      .getMany();

    return {
      data: users.map((user) => ({
        id: user.id,
        name: user.name,
        lastName: user.lastName,
        email: user.email,
        phoneNumber: user.phoneNumber,
      })),
      total,
      offset,
      limit,
    };
  }

  async addExpertToGroup(groupId: string, dto: AddExpertToGroupDto): Promise<AdminExpertGroupDetailsDto> {
    await this.dataSource.transaction(async (manager) => {
      await this.findActiveGroupOrThrow(groupId, manager);

      const userRepo = manager.getRepository(User);
      const memberRepo = manager.getRepository(ExpertPositionMember);
      const serviceRepo = manager.getRepository(ExpertPositionOffering);

      const expert = await userRepo.findOne({ where: { id: dto.expertId } });
      if (!expert) {
        throw new NotFoundException(`Эксперт с ID ${dto.expertId} не найден`);
      }
      if (expert.role !== UserRole.EXPERT) {
        throw new BadRequestException('Только пользователи с ролью EXPERT могут быть добавлены в группу');
      }

      const existing = await memberRepo.findOne({
        where: { positionId: groupId, userId: dto.expertId },
      });
      if (existing && !existing.deletedAt) {
        throw new BadRequestException('Эксперт уже в группе');
      }
      if (existing && existing.deletedAt) {
        existing.deletedAt = null;
        await memberRepo.save(existing);
      } else {
        const member = memberRepo.create({
          positionId: groupId,
          userId: dto.expertId,
        });
        await memberRepo.save(member);
      }

      const services = await serviceRepo.find({
        where: { positionId: groupId, deletedAt: IsNull() },
      });
      if (services.length) {
        const values = services.map((service) => ({
          expertId: dto.expertId,
          groupServiceId: service.id,
          price: Number(service.defaultPrice),
        }));
        await manager
          .createQueryBuilder()
          .insert()
          .into(ExpertServicePrice)
          .values(values)
          .orIgnore()
          .execute();
      }
    });

    return this.getAdminExpertGroupById(groupId);
  }

  async removeExpertFromGroup(groupId: string, expertId: string): Promise<void> {
    const member = await this.memberRepository.findOne({
      where: { positionId: groupId, userId: expertId, deletedAt: IsNull() },
    });
    if (!member) {
      throw new NotFoundException('Исполнитель не найден в этой группе');
    }

    const hasActiveOrders = await this.orderItemRepository
      .createQueryBuilder('item')
      .innerJoin('item.order', 'order')
      .where('item."expertPositionId" = :groupId', { groupId })
      .andWhere('item."executorUserId" = :expertId', { expertId })
      .andWhere('order.status IN (:...statuses)', {
        statuses: [OrderStatus.PendingPayment, OrderStatus.Planned, OrderStatus.InProgress],
      })
      .getExists();

    if (hasActiveOrders) {
      member.deletedAt = new Date();
      await this.memberRepository.save(member);
      return;
    }

    await this.dataSource.transaction(async (manager) => {
      const serviceIds = await manager
        .getRepository(ExpertPositionOffering)
        .createQueryBuilder('service')
        .select('service.id', 'id')
        .where('service."positionId" = :groupId', { groupId })
        .getRawMany<{ id: string }>();

      if (serviceIds.length) {
        await manager.delete(ExpertServicePrice, {
          expertId,
          groupServiceId: In(serviceIds.map((entry) => entry.id)),
        });
      }

      await manager.getRepository(ExpertPositionMember).remove(member);
    });
  }

  async createGroupService(groupId: string, dto: CreateGroupServiceDto): Promise<AdminExpertGroupDetailsDto> {
    await this.dataSource.transaction(async (manager) => {
      await this.findActiveGroupOrThrow(groupId, manager);
      const serviceRepo = manager.getRepository(ExpertPositionOffering);
      const memberRepo = manager.getRepository(ExpertPositionMember);

      const duplicate = await serviceRepo.findOne({
        where: { positionId: groupId, name: dto.name.trim(), deletedAt: IsNull() },
      });
      if (duplicate) {
        throw new BadRequestException('Услуга с таким названием уже есть в группе');
      }

      const service = serviceRepo.create({
        positionId: groupId,
        name: dto.name.trim(),
        description: dto.description?.trim() || null,
        defaultPrice: dto.defaultPrice,
      });
      const savedService = await serviceRepo.save(service);

      const members = await memberRepo.find({
        where: { positionId: groupId, deletedAt: IsNull() },
      });
      if (members.length) {
        await manager
          .createQueryBuilder()
          .insert()
          .into(ExpertServicePrice)
          .values(
            members.map((member) => ({
              expertId: member.userId,
              groupServiceId: savedService.id,
              price: Number(savedService.defaultPrice),
            })),
          )
          .orIgnore()
          .execute();
      }
    });

    return this.getAdminExpertGroupById(groupId);
  }

  async updateGroupService(
    groupId: string,
    serviceId: string,
    dto: UpdateGroupServiceDto,
  ): Promise<AdminExpertGroupDetailsDto> {
    const service = await this.offeringRepository.findOne({
      where: { id: serviceId, positionId: groupId, deletedAt: IsNull() },
    });
    if (!service) {
      throw new NotFoundException('Услуга группы не найдена');
    }

    if (dto.name !== undefined) service.name = dto.name.trim();
    if (dto.description !== undefined) service.description = dto.description?.trim() || null;
    if (dto.defaultPrice !== undefined) service.defaultPrice = dto.defaultPrice;

    await this.offeringRepository.save(service);
    return this.getAdminExpertGroupById(groupId);
  }

  async removeGroupService(groupId: string, serviceId: string): Promise<void> {
    const service = await this.offeringRepository.findOne({
      where: { id: serviceId, positionId: groupId, deletedAt: IsNull() },
    });
    if (!service) {
      throw new NotFoundException('Услуга группы не найдена');
    }

    const hasOrders = await this.orderItemSubItemRepository.exist({
      where: { expertPositionOfferingId: serviceId },
    });

    if (hasOrders) {
      service.deletedAt = new Date();
      await this.offeringRepository.save(service);
      return;
    }

    await this.offeringRepository.remove(service);
  }

  async updateGroupPricesBulk(
    groupId: string,
    dto: BulkUpdateGroupPricesDto,
  ): Promise<AdminExpertGroupDetailsDto> {
    await this.applyGroupPriceUpdates(groupId, dto.items);
    return this.getAdminExpertGroupById(groupId);
  }

  async updateGroupPriceSingle(
    groupId: string,
    expertId: string,
    serviceId: string,
    dto: SingleUpdateGroupPriceDto,
  ): Promise<AdminExpertGroupDetailsDto> {
    await this.applyGroupPriceUpdates(groupId, [{
      expertId,
      serviceId,
      price: dto.price ?? null,
    }]);
    return this.getAdminExpertGroupById(groupId);
  }

  private async applyGroupPriceUpdates(
    groupId: string,
    items: UpdateGroupPriceCellDto[],
  ): Promise<void> {
    if (!items.length) {
      throw new BadRequestException('Список цен пуст');
    }

    await this.findActiveGroupOrThrow(groupId);

    const [members, services] = await Promise.all([
      this.memberRepository.find({
        where: { positionId: groupId, deletedAt: IsNull() },
      }),
      this.offeringRepository.find({
        where: { positionId: groupId, deletedAt: IsNull() },
      }),
    ]);

    const expertIds = new Set(members.map((member) => member.userId));
    const serviceIds = new Set(services.map((service) => service.id));
    for (const item of items) {
      if (!expertIds.has(item.expertId)) {
        throw new BadRequestException(`Эксперт ${item.expertId} не принадлежит группе`);
      }
      if (!serviceIds.has(item.serviceId)) {
        throw new BadRequestException(`Услуга ${item.serviceId} не принадлежит группе`);
      }
    }

    await this.dataSource.transaction(async (manager) => {
      await manager
        .createQueryBuilder()
        .insert()
        .into(ExpertServicePrice)
        .values(items.map((item) => ({
          expertId: item.expertId,
          groupServiceId: item.serviceId,
          price: item.price ?? null,
        })))
        .orUpdate(['price'], ['expertId', 'groupServiceId'])
        .execute();
    });
  }

  private async findActiveGroupOrThrow(
    groupId: string,
    manager?: EntityManager,
  ): Promise<ExpertPosition> {
    const repo = manager ? manager.getRepository(ExpertPosition) : this.positionRepository;
    const group = await repo.findOne({
      where: { id: groupId, deletedAt: IsNull() },
    });
    if (!group) {
      throw new NotFoundException('Группа экспертов не найдена');
    }
    return group;
  }
}
