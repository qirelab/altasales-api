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
  QueryFailedError,
  Repository,
} from 'typeorm';
import { OrderItem } from '../orders/entities/order-item.entity';
import { OrderItemSubItem } from '../orders/entities/order-item-sub-item.entity';
import { OrderStatus } from '../orders/entities/order-status.enum';
import { Service } from '../services/entities/service.entity';
import { ServiceType } from '../services/entities/service-type.enum';
import { User } from '../users/entities/user.entity';
import { UserRole } from '../users/entities/user-role.enum';
import { AuthService } from '../auth/auth.service';
import { FirebaseService } from '../auth/firebase/firebase.service';
import { Order } from '../orders/entities/order.entity';
import { AddExpertToGroupDto } from './dto/add-expert-to-group.dto';
import {
  CreateAdminExpertMemberDto,
  UpdateAdminExpertMemberDto,
} from './dto/admin-expert-member.dto';
import { PublicExpertProfileDto } from './dto/public-expert-profile.dto';
import { UpdateExpertProfileDto } from './dto/update-expert-profile.dto';
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
import { ExpertProfile } from './entities/expert-profile.entity';
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
  image: string | null;
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
  image: string | null;
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
    experienceYears: number | null;
    ordersCount: number;
  }>;
  services: Array<{
    id: string;
    name: string;
    description: string | null;
    defaultPrice: number;
  }>;
  prices: Record<string, Record<string, number | null>>;
  stats: {
    totalOrders: number;
    activeOrders: number;
    completedOrders: number;
    averageCheck: number | null;
  };
}

export interface AdminExpertGroupOrderItem {
  id: string;
  clientName: string;
  clientLastName: string;
  executorName: string | null;
  executorLastName: string | null;
  serviceName: string | null;
  amount: number;
  createdAt: Date;
  status: OrderStatus;
}

export interface AdminExpertGroupOrdersResponse {
  data: AdminExpertGroupOrderItem[];
  total: number;
  offset: number;
  limit: number;
}

export interface AvailableGroupExpertsDto {
  data: Array<{
    id: string;
    name: string;
    lastName: string;
    email: string;
    phoneNumber: string;
    experienceYears: number | null;
    assignedToGroupId: string | null;
  }>;
  total: number;
  offset: number;
  limit: number;
}

export interface AdminExpertMemberProfile {
  displayName: string | null;
  description: string;
  skills: string[];
  image: string | null;
  experienceYears: number | null;
}

interface FallbackExpertProfile {
  displayName: string | null;
  description: string;
  skills: string[];
  image: string | null;
  experienceYears: number | null;
}

export interface AdminExpertMemberListItem {
  id: string;
  name: string;
  lastName: string;
  email: string;
  phoneNumber: string;
  profile: AdminExpertMemberProfile;
  group: { id: string; title: string } | null;
  servicesCount: number;
  ordersCount: number;
}

export interface AdminExpertMemberDetails {
  user: {
    id: string;
    name: string;
    lastName: string;
    email: string;
    phoneNumber: string;
  };
  profile: AdminExpertMemberProfile;
  group: {
    id: string;
    title: string;
    description: string;
    image: string | null;
    services: Array<{
      id: string;
      name: string;
      description: string | null;
      defaultPrice: number;
      price: number | null;
    }>;
  } | null;
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
    status: OrderStatus;
  }>;
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
    @InjectRepository(ExpertProfile)
    private readonly expertProfileRepository: Repository<ExpertProfile>,
    @InjectRepository(OrderItem)
    private readonly orderItemRepository: Repository<OrderItem>,
    @InjectRepository(OrderItemSubItem)
    private readonly orderItemSubItemRepository: Repository<OrderItemSubItem>,
    private readonly dataSource: DataSource,
    private readonly authService: AuthService,
    private readonly firebaseService: FirebaseService,
  ) { }

  async findAllPositions(): Promise<ExpertPositionListItem[]> {
    const positions = await this.positionRepository.find({
      where: { deletedAt: IsNull() },
      order: { createdAt: 'ASC' },
      relations: ['offerings', 'members'],
    });

    const visiblePositions = positions.filter((position) => {
      const activeOfferingsCount = (position.offerings ?? []).filter((offering) => !offering.deletedAt).length;
      const activeExecutorsCount = (position.members ?? []).filter((member) => !member.deletedAt).length;
      return activeOfferingsCount > 0 && activeExecutorsCount > 0;
    });

    const positionIds = visiblePositions.map((p) => p.id);
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
    for (const position of positions) {
      for (const offering of position.offerings ?? []) {
        if (offering.deletedAt) continue;
        const price = Number(offering.defaultPrice);
        if (!Number.isFinite(price) || price <= 0) continue;
        const current = minPriceByPosition.get(position.id);
        if (current === undefined || price < current) {
          minPriceByPosition.set(position.id, price);
        }
      }
    }
    for (const row of memberOfferings) {
      const price = Number(row.price);
      if (!Number.isFinite(price) || price <= 0) continue;
      const current = minPriceByPosition.get(row.positionId);
      if (current === undefined || price < current) {
        minPriceByPosition.set(row.positionId, price);
      }
    }

    return visiblePositions.map((position) => ({
      id: position.id,
      name: position.name,
      description: position.description,
      image: position.image ?? null,
      executorsCount: (position.members ?? []).filter((member) => !member.deletedAt).length,
      offeringsCount: (position.offerings ?? []).filter((offering) => !offering.deletedAt).length,
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

    const activeMembers = (position.members ?? [])
      .filter((member) => !member.deletedAt);
    const executorUserIds = [...new Set(activeMembers.map((member) => member.userId))];
    const executorUsers = executorUserIds.length > 0
      ? await this.userRepository
        .createQueryBuilder('u')
        .select([
          'u.id',
          'u.name',
          'u.lastName',
          'u.experienceYears',
          'u.role',
        ])
        .where('u.id IN (:...executorUserIds)', { executorUserIds })
        .getMany()
      : [];
    const executorByUserId = new Map(executorUsers.map((user) => [user.id, user]));
    const fallbackExperienceByUserId = await this.loadFallbackExperienceYearsByUserIds(executorUserIds);
    const storedProfiles = executorUserIds.length > 0
      ? await this.expertProfileRepository.find({ where: { userId: In(executorUserIds) } })
      : [];
    const profileByUserId = new Map(storedProfiles.map((profile) => [profile.userId, profile]));
    const fallbackProfileByUserId = await this.loadFallbackExpertProfileByUserIds(executorUserIds);

    const executors = await Promise.all(
      activeMembers
        .map(async (member) => {
          const memberUser = executorByUserId.get(member.userId) ?? member.user;
          if (!memberUser) return null;
          const prices = await this.getMemberOfferingPrices(member.id, positionOfferings);
          if (memberUser.role !== UserRole.EXPERT) return null;
          const resolvedProfile = this.resolveExpertProfile(
            profileByUserId.get(memberUser.id),
            fallbackProfileByUserId.get(memberUser.id),
            memberUser.experienceYears,
          );
          return {
            id: memberUser.id,
            name: memberUser.name,
            lastName: memberUser.lastName,
            image: resolvedProfile.image,
            experienceYears: resolvedProfile.experienceYears
              ?? fallbackExperienceByUserId.get(memberUser.id)
              ?? null,
            offerings: prices,
          };
        }),
    );

    return {
      id: position.id,
      name: position.name,
      description: position.description,
      image: position.image ?? null,
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
    const priceByOfferingId = new Map(
      memberPrices
        .filter((entry) => entry.price !== null)
        .map((entry) => [entry.groupServiceId, Number(entry.price)]),
    );

    const offeringLines = offerings.map((offering) => ({
      offeringId: offering.id,
      unitPrice: priceByOfferingId.get(offering.id) ?? Number(offering.defaultPrice),
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
    return sortOfferingsByName(positionOfferings).map((offering) => ({
      offeringId: offering.id,
      name: offering.name,
      price: priceByOfferingId.get(offering.id) ?? Number(offering.defaultPrice),
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

    const expertMembers = members.filter((member) => member.user?.role === UserRole.EXPERT);

    const expertIds = expertMembers.map((member) => member.user!.id);
    const expertOrdersCountsRaw = expertIds.length > 0
      ? await this.orderItemRepository
        .createQueryBuilder('item')
        .select('item."executorUserId"', 'executorUserId')
        .addSelect('COUNT(item.id)', 'count')
        .where('item."expertPositionId" = :groupId', { groupId })
        .andWhere('item."executorUserId" IN (:...expertIds)', { expertIds })
        .groupBy('item."executorUserId"')
        .getRawMany<{ executorUserId: string; count: string }>()
      : [];
    const expertOrdersCountById = new Map(
      expertOrdersCountsRaw.map((row) => [row.executorUserId, Number(row.count)]),
    );
    const fallbackExperienceByUserId = await this.loadFallbackExperienceYearsByUserIds(expertIds);

    const experts = expertMembers.map((member) => ({
      id: member.user!.id,
      name: member.user!.name,
      lastName: member.user!.lastName,
      email: member.user!.email,
      phoneNumber: member.user!.phoneNumber,
      experienceYears: member.user!.experienceYears
        ?? fallbackExperienceByUserId.get(member.user!.id)
        ?? null,
      ordersCount: expertOrdersCountById.get(member.user!.id) ?? 0,
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

    const groupOrders = await this.orderItemRepository.find({
      where: { expertPositionId: groupId },
    });
    const activeStatuses = new Set<OrderStatus>([
      OrderStatus.PendingPayment,
      OrderStatus.Planned,
      OrderStatus.InProgress,
    ]);
    let totalOrders = 0;
    let activeOrders = 0;
    let completedOrders = 0;
    let completedAmountSum = 0;
    groupOrders.forEach((item) => {
      totalOrders += 1;
      if (activeStatuses.has(item.status)) activeOrders += 1;
      if (item.status === OrderStatus.Completed) {
        completedOrders += 1;
        completedAmountSum += Number(item.amount);
      }
    });
    const averageCheck = completedOrders > 0 ? completedAmountSum / completedOrders : null;

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
      stats: {
        totalOrders,
        activeOrders,
        completedOrders,
        averageCheck,
      },
    };
  }

  async getAdminExpertGroupOrders(
    groupId: string,
    query: ExpertGroupsQueryDto,
  ): Promise<AdminExpertGroupOrdersResponse> {
    await this.findActiveGroupOrThrow(groupId);
    const { offset = 0, limit = 20 } = query;

    const total = await this.orderItemRepository.count({
      where: { expertPositionId: groupId },
    });

    const idRows = await this.orderItemRepository
      .createQueryBuilder('item')
      .leftJoin('item.order', 'parent_order')
      .select('item.id', 'id')
      .where('item."expertPositionId" = :groupId', { groupId })
      .orderBy('parent_order."createdAt"', 'DESC')
      .offset(offset)
      .limit(limit)
      .getRawMany<{ id: string }>();
    const itemIds = idRows.map((row) => row.id);

    const items = itemIds.length === 0 ? [] : await this.orderItemRepository
      .createQueryBuilder('item')
      .leftJoinAndSelect('item.order', 'parent_order')
      .leftJoinAndSelect('parent_order.user', 'client')
      .leftJoinAndSelect('item.executor', 'executor')
      .leftJoinAndSelect('item.subItems', 'subItem')
      .leftJoinAndSelect('subItem.expertPositionOffering', 'offering')
      .where('item.id IN (:...itemIds)', { itemIds })
      .orderBy('parent_order."createdAt"', 'DESC')
      .getMany();

    const data: AdminExpertGroupOrderItem[] = items.map((item) => {
      const firstOffering = item.subItems?.find((sub) => sub.expertPositionOffering)?.expertPositionOffering;
      return {
        id: item.orderId,
        clientName: item.order?.user?.name ?? '',
        clientLastName: item.order?.user?.lastName ?? '',
        executorName: item.executor?.name ?? null,
        executorLastName: item.executor?.lastName ?? null,
        serviceName: firstOffering?.name ?? null,
        amount: Number(item.amount),
        createdAt: item.order?.createdAt ?? new Date(0),
        status: item.status,
      };
    });

    return { data, total, offset, limit };
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
    const fallbackExperienceByUserId = await this.loadFallbackExperienceYearsByUserIds(users.map((user) => user.id));
    const assignedByUserId = await this.loadAssignedGroupsByUserIds(users.map((user) => user.id));

    return {
      data: users.map((user) => ({
        id: user.id,
        name: user.name,
        lastName: user.lastName,
        email: user.email,
        phoneNumber: user.phoneNumber,
        experienceYears: user.experienceYears ?? fallbackExperienceByUserId.get(user.id) ?? null,
        assignedToGroupId: assignedByUserId.get(user.id) ?? null,
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
    const fallbackExperienceByUserId = await this.loadFallbackExperienceYearsByUserIds(users.map((user) => user.id));
    const assignedByUserId = await this.loadAssignedGroupsByUserIds(users.map((user) => user.id));

    return {
      data: users.map((user) => ({
        id: user.id,
        name: user.name,
        lastName: user.lastName,
        email: user.email,
        phoneNumber: user.phoneNumber,
        experienceYears: user.experienceYears ?? fallbackExperienceByUserId.get(user.id) ?? null,
        assignedToGroupId: assignedByUserId.get(user.id) ?? null,
      })),
      total,
      offset,
      limit,
    };
  }

  async addExpertToGroup(groupId: string, dto: AddExpertToGroupDto): Promise<AdminExpertGroupDetailsDto> {
    try {
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

        const activeMembership = await memberRepo
          .createQueryBuilder('member')
          .innerJoin(ExpertPosition, 'position', 'position.id = member."positionId"')
          .where('member."userId" = :expertId', { expertId: dto.expertId })
          .andWhere('member."deletedAt" IS NULL')
          .andWhere('position."deletedAt" IS NULL')
          .orderBy('member."createdAt"', 'ASC')
          .addOrderBy('member.id', 'ASC')
          .getOne();

        if (activeMembership && activeMembership.positionId !== groupId) {
          throw new BadRequestException('Эксперт уже состоит в другой группе');
        }
        if (activeMembership && activeMembership.positionId === groupId) {
          throw new BadRequestException('Эксперт уже в группе');
        }

        const existing = await memberRepo.findOne({
          where: { positionId: groupId, userId: dto.expertId },
        });
        if (existing && existing.deletedAt) {
          existing.deletedAt = null;
          await memberRepo.save(existing);
        } else if (!existing) {
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
    } catch (error) {
      if (
        error instanceof QueryFailedError
        && String(error.message).includes('UQ_expert_position_member_user_active')
      ) {
        throw new BadRequestException('Эксперт уже состоит в другой группе');
      }
      throw error;
    }

    return this.getAdminExpertGroupById(groupId);
  }

  private async loadAssignedGroupsByUserIds(userIds: string[]): Promise<Map<string, string>> {
    if (userIds.length === 0) {
      return new Map();
    }

    const raw = await this.memberRepository
      .createQueryBuilder('member')
      .innerJoin(ExpertPosition, 'position', 'position.id = member."positionId"')
      .select('member."userId"', 'userId')
      .addSelect('member."positionId"', 'positionId')
      .where('member."userId" IN (:...userIds)', { userIds })
      .andWhere('member."deletedAt" IS NULL')
      .andWhere('position."deletedAt" IS NULL')
      .orderBy('member."userId"', 'ASC')
      .addOrderBy('member."createdAt"', 'ASC')
      .addOrderBy('member.id', 'ASC')
      .getRawMany<{ userId: string; positionId: string }>();

    const assignedByUserId = new Map<string, string>();
    for (const row of raw) {
      if (!assignedByUserId.has(row.userId)) {
        assignedByUserId.set(row.userId, row.positionId);
      }
    }
    return assignedByUserId;
  }

  private async loadFallbackExperienceYearsByUserIds(userIds: string[]): Promise<Map<string, number>> {
    if (userIds.length === 0) {
      return new Map();
    }

    const rows = await this.dataSource
      .getRepository(Service)
      .createQueryBuilder('service')
      .select('service."userId"', 'userId')
      .addSelect('MAX(service."contractorExperienceYears")', 'experienceYears')
      .where('service."userId" IN (:...userIds)', { userIds })
      .andWhere('service.type = :contractorType', { contractorType: ServiceType.Contractor })
      .andWhere('service."deletedAt" IS NULL')
      .andWhere('service."contractorExperienceYears" IS NOT NULL')
      .groupBy('service."userId"')
      .getRawMany<{ userId: string; experienceYears: string | null }>();

    return new Map(
      rows
        .filter((row) => row.experienceYears !== null)
        .map((row) => [row.userId, Number(row.experienceYears)]),
    );
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

  async createGroupService(groupId: string, dto: CreateGroupServiceDto): Promise<{
    id: string;
    name: string;
    description: string | null;
    defaultPrice: number;
  }> {
    let createdServiceId = '';
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
      createdServiceId = savedService.id;

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

    const created = await this.offeringRepository.findOneOrFail({
      where: { id: createdServiceId },
    });
    return {
      id: created.id,
      name: created.name,
      description: created.description,
      defaultPrice: Number(created.defaultPrice),
    };
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

  async getAdminExpertMembers(query: ExpertGroupsQueryDto): Promise<{
    data: AdminExpertMemberListItem[];
    total: number;
    offset: number;
    limit: number;
  }> {
    const { offset = 0, limit = 20 } = query;
    const search = query.search?.trim();

    const qb = this.userRepository
      .createQueryBuilder('u')
      .leftJoin(ExpertProfile, 'profile', 'profile."userId" = u.id')
      .where('u.role = :role', { role: UserRole.EXPERT });

    if (search) {
      qb.andWhere(
        new Brackets((subQb) => {
          subQb
            .where('u.name ILIKE :search', { search: `%${search}%` })
            .orWhere('u."lastName" ILIKE :search', { search: `%${search}%` })
            .orWhere(`CONCAT(u.name, ' ', u."lastName") ILIKE :search`, { search: `%${search}%` })
            .orWhere('u.email ILIKE :search', { search: `%${search}%` })
            .orWhere('u."phoneNumber" ILIKE :search', { search: `%${search}%` })
            .orWhere('profile."displayName" ILIKE :search', { search: `%${search}%` })
            .orWhere('profile.description ILIKE :search', { search: `%${search}%` })
            .orWhere('profile.skills::jsonb @> :skill::jsonb', { skill: JSON.stringify([search]) });
        }),
      );
    }

    const total = await qb.getCount();
    const users = await qb
      .orderBy('u."createdAt"', 'DESC')
      .offset(offset)
      .limit(limit)
      .getMany();

    if (!users.length) {
      return { data: [], total, offset, limit };
    }

    const userIds = users.map((user) => user.id);
    const profiles = await this.expertProfileRepository.find({ where: { userId: In(userIds) } });
    const profileByUserId = new Map(profiles.map((profile) => [profile.userId, profile]));
    const fallbackProfileByUserId = await this.loadFallbackExpertProfileByUserIds(userIds);
    const assignedByUserId = await this.loadAssignedGroupsByUserIds(userIds);
    const groupIds = [...new Set([...assignedByUserId.values()])];

    const groupsById = new Map<string, ExpertPosition>();
    if (groupIds.length) {
      const groups = await this.positionRepository.find({
        where: { id: In(groupIds), deletedAt: IsNull() },
      });
      groups.forEach((group) => groupsById.set(group.id, group));
    }

    const servicesCountsRaw = groupIds.length
      ? await this.offeringRepository
        .createQueryBuilder('service')
        .select('service."positionId"', 'positionId')
        .addSelect('COUNT(service.id)', 'count')
        .where('service."positionId" IN (:...groupIds)', { groupIds })
        .andWhere('service."deletedAt" IS NULL')
        .groupBy('service."positionId"')
        .getRawMany<{ positionId: string; count: string }>()
      : [];
    const servicesCountByGroup = new Map(
      servicesCountsRaw.map((row) => [row.positionId, Number(row.count)]),
    );

    const ordersCountsRaw = await this.orderItemRepository
      .createQueryBuilder('item')
      .select('item."executorUserId"', 'userId')
      .addSelect('COUNT(item.id)', 'count')
      .where('item."executorUserId" IN (:...userIds)', { userIds })
      .groupBy('item."executorUserId"')
      .getRawMany<{ userId: string; count: string }>();
    const ordersCountByUserId = new Map(
      ordersCountsRaw.map((row) => [row.userId, Number(row.count)]),
    );

    return {
      data: users.map((user) => {
        const groupId = assignedByUserId.get(user.id) ?? null;
        const group = groupId ? groupsById.get(groupId) : undefined;
        const profile = this.resolveExpertProfile(
          profileByUserId.get(user.id),
          fallbackProfileByUserId.get(user.id),
          user.experienceYears,
        );
        return {
          id: user.id,
          name: user.name,
          lastName: user.lastName,
          email: user.email,
          phoneNumber: user.phoneNumber,
          profile,
          group: group ? { id: group.id, title: group.name } : null,
          servicesCount: groupId ? (servicesCountByGroup.get(groupId) ?? 0) : 0,
          ordersCount: ordersCountByUserId.get(user.id) ?? 0,
        };
      }),
      total,
      offset,
      limit,
    };
  }

  async getAdminExpertMemberById(userId: string): Promise<AdminExpertMemberDetails> {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user || user.role !== UserRole.EXPERT) {
      throw new NotFoundException(`Эксперт с ID ${userId} не найден`);
    }

    const storedProfile = await this.expertProfileRepository.findOne({ where: { userId } });
    const fallbackProfileByUserId = await this.loadFallbackExpertProfileByUserIds([userId]);
    const profile = this.resolveExpertProfile(
      storedProfile,
      fallbackProfileByUserId.get(userId),
      user.experienceYears,
    );
    const assignedByUserId = await this.loadAssignedGroupsByUserIds([userId]);
    const groupId = assignedByUserId.get(userId) ?? null;

    let group: AdminExpertMemberDetails['group'] = null;
    if (groupId) {
      const position = await this.findActiveGroupOrThrow(groupId);
      const services = await this.offeringRepository.find({
        where: { positionId: groupId, deletedAt: IsNull() },
        order: { name: 'ASC' },
      });
      const prices = services.length
        ? await this.expertServicePriceRepository.find({
          where: {
            expertId: userId,
            groupServiceId: In(services.map((service) => service.id)),
          },
        })
        : [];
      const priceByServiceId = new Map(
        prices.map((entry) => [entry.groupServiceId, entry.price === null ? null : Number(entry.price)]),
      );

      group = {
        id: position.id,
        title: position.name,
        description: position.description,
        image: position.image ?? null,
        services: services.map((service) => ({
          id: service.id,
          name: service.name,
          description: service.description,
          defaultPrice: Number(service.defaultPrice),
          price: priceByServiceId.get(service.id) ?? null,
        })),
      };
    }

    const activeStatuses = [
      OrderStatus.PendingPayment,
      OrderStatus.Planned,
      OrderStatus.InProgress,
    ];

    const aggregateRaw = await this.orderItemRepository.manager
      .getRepository(Order)
      .createQueryBuilder('o')
      .innerJoin('o.item', 'item')
      .select('COUNT(o.id)', 'totalProjects')
      .addSelect(
        `SUM(CASE WHEN o.status IN (:...activeStatuses) THEN 1 ELSE 0 END)`,
        'activeOrders',
      )
      .addSelect(
        `COALESCE(SUM(CASE WHEN o.status = :completedStatus THEN o.amount ELSE 0 END), 0)`,
        'totalIncome',
      )
      .where('item."executorUserId" = :userId', { userId })
      .setParameter('activeStatuses', activeStatuses)
      .setParameter('completedStatus', OrderStatus.Completed)
      .getRawOne<{
        totalProjects: string | null;
        activeOrders: string | null;
        totalIncome: string | null;
      }>();

    const ordersRaw = await this.orderItemRepository.manager
      .getRepository(Order)
      .createQueryBuilder('o')
      .innerJoin('o.item', 'item')
      .select('o.id', 'id')
      .addSelect('COALESCE(item.hours, 0)', 'hours')
      .addSelect('o."createdAt"', 'createdAt')
      .addSelect('o.amount', 'amount')
      .addSelect('o.status', 'status')
      .where('item."executorUserId" = :userId', { userId })
      .orderBy('o."createdAt"', 'DESC')
      .getRawMany<{
        id: string;
        hours: string;
        createdAt: Date;
        amount: string;
        status: OrderStatus;
      }>();

    return {
      user: {
        id: user.id,
        name: user.name,
        lastName: user.lastName,
        email: user.email,
        phoneNumber: user.phoneNumber,
      },
      profile,
      group,
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

  async createAdminExpertMember(dto: CreateAdminExpertMemberDto): Promise<AdminExpertMemberListItem> {
    const registerResult = await this.authService.register({
      name: dto.name.trim(),
      lastName: dto.lastName.trim(),
      email: dto.email.trim(),
      phoneNumber: dto.phoneNumber.trim(),
      password: dto.password,
    });

    const user = await this.userRepository.findOne({ where: { id: registerResult.id } });
    if (!user) {
      throw new NotFoundException('Не удалось создать эксперта');
    }

    user.role = UserRole.EXPERT;
    await this.userRepository.save(user);

    const profileEntity = this.expertProfileRepository.create({
      userId: user.id,
      description: dto.description.trim(),
      skills: dto.skills,
      image: dto.image ?? null,
      experienceYears: dto.experienceYears,
    });
    await this.expertProfileRepository.save(profileEntity);

    return {
      id: user.id,
      name: user.name,
      lastName: user.lastName,
      email: user.email,
      phoneNumber: user.phoneNumber,
      profile: this.mapExpertProfileEntity(profileEntity),
      group: null,
      servicesCount: 0,
      ordersCount: 0,
    };
  }

  async updateAdminExpertMember(
    userId: string,
    dto: UpdateAdminExpertMemberDto,
  ): Promise<AdminExpertMemberDetails> {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user || user.role !== UserRole.EXPERT) {
      throw new NotFoundException(`Эксперт с ID ${userId} не найден`);
    }

    if (dto.email && dto.email !== user.email) {
      const existingUser = await this.userRepository.findOne({ where: { email: dto.email } });
      if (existingUser) {
        throw new ConflictException('Пользователь с таким email уже существует');
      }
    }

    if (dto.name !== undefined) user.name = dto.name.trim();
    if (dto.lastName !== undefined) user.lastName = dto.lastName.trim();
    if (dto.email !== undefined) user.email = dto.email.trim();
    if (dto.phoneNumber !== undefined) user.phoneNumber = dto.phoneNumber.trim();
    await this.userRepository.save(user);

    let profileEntity = await this.expertProfileRepository.findOne({ where: { userId } });
    if (!profileEntity) {
      profileEntity = this.expertProfileRepository.create({ userId, skills: [] });
    }
    if (dto.description !== undefined) profileEntity.description = dto.description.trim();
    if (dto.skills !== undefined) profileEntity.skills = dto.skills;
    if (dto.image !== undefined) profileEntity.image = dto.image;
    if (dto.experienceYears !== undefined) profileEntity.experienceYears = dto.experienceYears;
    await this.expertProfileRepository.save(profileEntity);

    return this.getAdminExpertMemberById(userId);
  }

  async removeAdminExpertMember(userId: string): Promise<void> {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user || user.role !== UserRole.EXPERT) {
      throw new NotFoundException(`Эксперт с ID ${userId} не найден`);
    }

    const hasActiveOrders = await this.orderItemRepository
      .createQueryBuilder('item')
      .innerJoin('item.order', 'order')
      .where('item."executorUserId" = :userId', { userId })
      .andWhere('order.status IN (:...statuses)', {
        statuses: [OrderStatus.PendingPayment, OrderStatus.Planned, OrderStatus.InProgress],
      })
      .getExists();

    if (hasActiveOrders) {
      throw new BadRequestException('Нельзя удалить эксперта с активными покупками');
    }

    const assignedByUserId = await this.loadAssignedGroupsByUserIds([userId]);
    const groupId = assignedByUserId.get(userId);
    if (groupId) {
      await this.removeExpertFromGroup(groupId, userId);
    }

    const firebaseUid = user.firebaseUid;
    await this.userRepository.remove(user);

    if (firebaseUid) {
      try {
        await this.firebaseService.getAuth().deleteUser(firebaseUid);
      } catch {
        // ignore firebase cleanup errors
      }
    }
  }

  private mapExpertProfileEntity(profile: ExpertProfile): AdminExpertMemberProfile {
    return {
      displayName: profile.displayName,
      description: profile.description ?? '',
      skills: profile.skills ?? [],
      image: profile.image,
      experienceYears: profile.experienceYears,
    };
  }

  private resolveExpertProfile(
    profile: ExpertProfile | null | undefined,
    fallback: FallbackExpertProfile | undefined,
    legacyUserExperienceYears: number | null,
  ): AdminExpertMemberProfile {
    return {
      displayName: profile?.displayName ?? fallback?.displayName ?? null,
      description: profile?.description ?? fallback?.description ?? '',
      skills: profile?.skills?.length ? profile.skills : (fallback?.skills ?? []),
      image: profile?.image ?? fallback?.image ?? null,
      experienceYears: profile?.experienceYears
        ?? fallback?.experienceYears
        ?? legacyUserExperienceYears
        ?? null,
    };
  }

  private async loadFallbackExpertProfileByUserIds(
    userIds: string[],
  ): Promise<Map<string, FallbackExpertProfile>> {
    if (!userIds.length) {
      return new Map();
    }

    const rows = await this.dataSource
      .getRepository(Service)
      .createQueryBuilder('service')
      .select('service."userId"', 'userId')
      .addSelect('service.name', 'displayName')
      .addSelect('service.description', 'description')
      .addSelect('service.skills', 'skills')
      .addSelect('service.image', 'image')
      .addSelect('service."contractorExperienceYears"', 'experienceYears')
      .where('service."userId" IN (:...userIds)', { userIds })
      .andWhere('service.type = :contractorType', { contractorType: ServiceType.Contractor })
      .andWhere('service."deletedAt" IS NULL')
      .getRawMany<{
        userId: string;
        displayName: string | null;
        description: string | null;
        skills: string[] | null;
        image: string | null;
        experienceYears: string | null;
      }>();

    return new Map(
      rows.map((row) => [row.userId, {
        displayName: row.displayName,
        description: row.description ?? '',
        skills: row.skills ?? [],
        image: row.image,
        experienceYears: row.experienceYears === null ? null : Number(row.experienceYears),
      }]),
    );
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

  async findPublicExpertProfile(userId: string): Promise<PublicExpertProfileDto> {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user || user.role !== UserRole.EXPERT) {
      throw new NotFoundException(`Эксперт с ID ${userId} не найден`);
    }

    const assignedByUserId = await this.loadAssignedGroupsByUserIds([userId]);
    const groupId = assignedByUserId.get(userId) ?? null;
    if (!groupId) {
      throw new NotFoundException(`Эксперт с ID ${userId} не найден`);
    }

    const storedProfile = await this.expertProfileRepository.findOne({ where: { userId } });
    const fallbackProfileByUserId = await this.loadFallbackExpertProfileByUserIds([userId]);
    const resolvedProfile = this.resolveExpertProfile(
      storedProfile,
      fallbackProfileByUserId.get(userId),
      user.experienceYears,
    );

    const position = await this.findActiveGroupOrThrow(groupId);
    const services = await this.offeringRepository.find({
      where: { positionId: groupId, deletedAt: IsNull() },
      order: { name: 'ASC' },
    });
    const prices = services.length
      ? await this.expertServicePriceRepository.find({
        where: {
          expertId: userId,
          groupServiceId: In(services.map((service) => service.id)),
        },
      })
      : [];
    const priceByServiceId = new Map(
      prices.map((entry) => [entry.groupServiceId, entry.price === null ? null : Number(entry.price)]),
    );

    const aggregateRaw = await this.orderItemRepository.manager
      .getRepository(Order)
      .createQueryBuilder('o')
      .innerJoin('o.item', 'item')
      .select('COUNT(o.id)', 'totalProjects')
      .addSelect(
        `SUM(CASE WHEN o.status = :completedStatus THEN 1 ELSE 0 END)`,
        'completedProjects',
      )
      .where('item."executorUserId" = :userId', { userId })
      .setParameter('completedStatus', OrderStatus.Completed)
      .getRawOne<{
        totalProjects: string | null;
        completedProjects: string | null;
      }>();

    return {
      id: user.id,
      name: user.name,
      lastName: user.lastName,
      profile: {
        description: resolvedProfile.description,
        skills: resolvedProfile.skills,
        image: resolvedProfile.image,
        experienceYears: resolvedProfile.experienceYears,
      },
      group: {
        id: position.id,
        title: position.name,
        description: position.description,
        image: position.image ?? null,
        services: services.map((service) => ({
          id: service.id,
          name: service.name,
          description: service.description,
          defaultPrice: Number(service.defaultPrice),
          price: priceByServiceId.get(service.id) ?? null,
        })),
      },
      stats: {
        totalProjects: Number(aggregateRaw?.totalProjects ?? 0),
        completedProjects: Number(aggregateRaw?.completedProjects ?? 0),
      },
    };
  }

  async updateExpertProfile(
    userId: string,
    dto: UpdateExpertProfileDto,
  ): Promise<PublicExpertProfileDto> {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user || user.role !== UserRole.EXPERT) {
      throw new NotFoundException('Эксперт не найден');
    }

    let profileEntity = await this.expertProfileRepository.findOne({ where: { userId } });
    if (!profileEntity) {
      profileEntity = this.expertProfileRepository.create({ userId, skills: [] });
    }
    if (dto.description !== undefined) profileEntity.description = dto.description.trim();
    if (dto.skills !== undefined) profileEntity.skills = dto.skills;
    if (dto.image !== undefined) profileEntity.image = dto.image;
    if (dto.experienceYears !== undefined) profileEntity.experienceYears = dto.experienceYears;
    await this.expertProfileRepository.save(profileEntity);

    return this.findPublicExpertProfile(userId);
  }
}
