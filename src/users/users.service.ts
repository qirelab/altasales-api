import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, Repository } from 'typeorm';
import { OrdersService } from '../orders/orders.service';
import { Order } from '../orders/entities/order.entity';
import { OrderStatus } from '../orders/entities/order-status.enum';
import { CreateUserDto } from './dto/create-user.dto';
import { GetAdminUsersQueryDto } from './dto/get-admin-users-query.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserRole } from './entities/user-role.enum';
import { User } from './entities/user.entity';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly ordersService: OrdersService,
  ) { }

  async create(createUserDto: CreateUserDto): Promise<User> {
    const existingUser = await this.userRepository.findOne({
      where: { email: createUserDto.email },
    });

    if (existingUser) {
      throw new ConflictException('Пользователь с таким email уже существует');
    }

    const user = this.userRepository.create(createUserDto);
    return await this.userRepository.save(user);
  }

  async findAll(): Promise<User[]> {
    return await this.userRepository.find();
  }

  async findAllForAdmin(query: GetAdminUsersQueryDto): Promise<{
    data: Array<{
      id: string;
      name: string;
      lastName: string;
      email: string;
      phoneNumber: string;
      ordersCount: number;
      registrationDate: Date;
    }>;
    total: number;
    offset: number;
    limit: number;
  }> {
    const { offset = 0, limit = 20 } = query;
    const search = query.search?.trim();

    const baseQb = this.userRepository
      .createQueryBuilder('u')
      .where('u.role = :role', { role: UserRole.USER });

    if (search) {
      baseQb.andWhere(
        new Brackets((qb) => {
          qb
            .where('u.name ILIKE :search', { search: `%${search}%` })
            .orWhere('u."lastName" ILIKE :search', { search: `%${search}%` })
            .orWhere(`CONCAT(u.name, ' ', u."lastName") ILIKE :search`, { search: `%${search}%` })
            .orWhere('u.email ILIKE :search', { search: `%${search}%` })
            .orWhere('u."phoneNumber" ILIKE :search', { search: `%${search}%` });
        }),
      );
    }

    const total = await baseQb.getCount();

    const rows = await baseQb
      .clone()
      .leftJoin(Order, 'ord', 'ord."userId" = u.id')
      .select('u.id', 'id')
      .addSelect('u.name', 'name')
      .addSelect('u."lastName"', 'lastName')
      .addSelect('u.email', 'email')
      .addSelect('u."phoneNumber"', 'phoneNumber')
      .addSelect('u."createdAt"', 'registrationDate')
      .addSelect('COUNT(ord.id)', 'ordersCount')
      .groupBy('u.id')
      .addGroupBy('u.name')
      .addGroupBy('u."lastName"')
      .addGroupBy('u.email')
      .addGroupBy('u."phoneNumber"')
      .addGroupBy('u."createdAt"')
      .orderBy('u."createdAt"', 'DESC')
      .offset(offset)
      .limit(limit)
      .getRawMany<{
        id: string;
        name: string;
        lastName: string;
        email: string;
        phoneNumber: string;
        registrationDate: Date;
        ordersCount: string;
      }>();

    return {
      data: rows.map((row) => ({
        id: row.id,
        name: row.name,
        lastName: row.lastName,
        email: row.email,
        phoneNumber: row.phoneNumber,
        registrationDate: row.registrationDate,
        ordersCount: Number(row.ordersCount),
      })),
      total,
      offset,
      limit,
    };
  }

  async findOne(id: string): Promise<User> {
    const user = await this.userRepository.findOne({ where: { id } });
    if (!user) {
      throw new NotFoundException(`Пользователь с ID ${id} не найден`);
    }
    return user;
  }

  async findOneForAdmin(userId: string): Promise<{
    user: {
      id: string;
      name: string;
      lastName: string;
      email: string;
      phoneNumber: string;
      registrationDate: Date;
    };
    stats: {
      ordersCount: number;
      activeOrders: number;
      totalOrdersAmount: number;
    };
    orders: Array<{
      orderNumber: string;
      positions: number;
      createdAt: Date;
      amount: number;
      status: OrderStatus;
    }>;
  }> {
    const user = await this.findOne(userId);

    const aggregateRaw = await this.userRepository.manager
      .getRepository(Order)
      .createQueryBuilder('o')
      .select('COUNT(o.id)', 'ordersCount')
      .addSelect(
        `SUM(CASE WHEN o.status IN (:...activeStatuses) THEN 1 ELSE 0 END)`,
        'activeOrders',
      )
      .addSelect('COALESCE(SUM(o.amount), 0)', 'totalOrdersAmount')
      .where('o."userId" = :userId', { userId })
      .setParameter('activeStatuses', [
        OrderStatus.PendingPayment,
        OrderStatus.Planned,
        OrderStatus.InProgress,
      ])
      .getRawOne<{
        ordersCount: string | null;
        activeOrders: string | null;
        totalOrdersAmount: string | null;
      }>();

    const ordersRaw = await this.userRepository.manager
      .getRepository(Order)
      .createQueryBuilder('o')
      .leftJoin('o.item', 'item')
      .select('o.id', 'orderNumber')
      .addSelect('CASE WHEN item.id IS NULL THEN 0 ELSE 1 END', 'positions')
      .addSelect('o."createdAt"', 'createdAt')
      .addSelect('o.amount', 'amount')
      .addSelect('o.status', 'status')
      .where('o."userId" = :userId', { userId })
      .orderBy('o."createdAt"', 'DESC')
      .getRawMany<{
        orderNumber: string;
        positions: string;
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
        registrationDate: user.createdAt,
      },
      stats: {
        ordersCount: Number(aggregateRaw?.ordersCount ?? 0),
        activeOrders: Number(aggregateRaw?.activeOrders ?? 0),
        totalOrdersAmount: Number(aggregateRaw?.totalOrdersAmount ?? 0),
      },
      orders: ordersRaw.map((order) => ({
        orderNumber: order.orderNumber,
        positions: Number(order.positions),
        createdAt: order.createdAt,
        amount: Number(order.amount),
        status: order.status,
      })),
    };
  }

  async update(id: string, updateUserDto: UpdateUserDto): Promise<User> {
    const user = await this.findOne(id);

    if (updateUserDto.email && updateUserDto.email !== user.email) {
      const existingUser = await this.userRepository.findOne({
        where: { email: updateUserDto.email },
      });
      if (existingUser) {
        throw new ConflictException('Пользователь с таким email уже существует');
      }
    }

    Object.assign(user, updateUserDto);
    return await this.userRepository.save(user);
  }

  async remove(id: string): Promise<void> {
    const user = await this.findOne(id);
    await this.userRepository.remove(user);
  }

  async getProfile(userId: string) {
    const user = await this.findOne(userId);
    const stats = await this.ordersService.getOrderCountsByUserId(userId);
    return {
      profile: {
        email: user.email,
        phoneNumber: user.phoneNumber,
        name: user.name,
        lastName: user.lastName,
        balance: Number(user.balance),
        role: user.role,
      },
      stats,
    };
  }
}
