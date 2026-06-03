import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { UserRole } from '../users/entities/user-role.enum';
import { OrdersService } from '../orders/orders.service';
import { ExpertCheckoutDto } from './dto/expert-checkout.dto';
import { ExpertPosition } from './entities/expert-position.entity';
import { ExpertPositionMember } from './entities/expert-position-member.entity';
import { ExpertPositionOffering } from './entities/expert-position-offering.entity';

const OFFERING_CODE_ORDER = ['consultation', 'audit', 'support'] as const;

export interface ExpertPositionListItem {
  id: string;
  name: string;
  description: string;
}

export interface ExpertExecutorDto {
  id: string;
  name: string;
  lastName: string;
}

export interface ExpertPositionDetailDto extends ExpertPositionListItem {
  offerings: Array<{
    id: string;
    code: string;
    name: string;
    description: string | null;
    defaultPrice: number;
  }>;
  executors: ExpertExecutorDto[];
}

@Injectable()
export class ExpertsService {
  constructor(
    @InjectRepository(ExpertPosition)
    private readonly positionRepository: Repository<ExpertPosition>,
    @InjectRepository(ExpertPositionOffering)
    private readonly offeringRepository: Repository<ExpertPositionOffering>,
    @InjectRepository(ExpertPositionMember)
    private readonly memberRepository: Repository<ExpertPositionMember>,
    private readonly ordersService: OrdersService,
  ) { }

  async findAllPositions(): Promise<ExpertPositionListItem[]> {
    const positions = await this.positionRepository.find({
      order: { createdAt: 'ASC' },
    });
    return positions.map((position) => ({
      id: position.id,
      name: position.name,
      description: position.description,
    }));
  }

  async findPositionById(id: string): Promise<ExpertPositionDetailDto> {
    const position = await this.positionRepository.findOne({
      where: { id },
      relations: ['offerings', 'members', 'members.user'],
    });
    if (!position) {
      throw new NotFoundException(`Expert position with id ${id} not found`);
    }

    const offerings = [...(position.offerings ?? [])]
      .sort(
        (a, b) => OFFERING_CODE_ORDER.indexOf(a.code as typeof OFFERING_CODE_ORDER[number])
          - OFFERING_CODE_ORDER.indexOf(b.code as typeof OFFERING_CODE_ORDER[number]),
      )
      .map((offering) => ({
        id: offering.id,
        code: offering.code,
        name: offering.name,
        description: offering.description,
        defaultPrice: Number(offering.defaultPrice),
      }));

    const executors = [...(position.members ?? [])]
      .map((member) => member.user)
      .filter((user): user is NonNullable<typeof user> => Boolean(user))
      .map((user) => ({
        id: user.id,
        name: user.name,
        lastName: user.lastName,
      }));

    return {
      id: position.id,
      name: position.name,
      description: position.description,
      offerings,
      executors,
    };
  }

  async checkout(dto: ExpertCheckoutDto, userId: string) {
    const uniqueOfferingIds = [...new Set(dto.offeringIds)];
    if (uniqueOfferingIds.length !== dto.offeringIds.length) {
      throw new BadRequestException('Duplicate offering IDs are not allowed');
    }

    const position = await this.positionRepository.findOne({ where: { id: dto.positionId } });
    if (!position) {
      throw new NotFoundException(`Expert position with id ${dto.positionId} not found`);
    }

    const offerings = await this.offeringRepository.find({
      where: { id: In(uniqueOfferingIds), positionId: dto.positionId },
    });
    if (offerings.length !== uniqueOfferingIds.length) {
      throw new BadRequestException('One or more offerings do not belong to the selected position');
    }

    const member = await this.memberRepository.findOne({
      where: { positionId: dto.positionId, userId: dto.executorUserId },
      relations: ['user'],
    });
    if (!member?.user) {
      throw new ConflictException('Selected executor is not assigned to this position');
    }
    if (member.user.role !== UserRole.EXPERT) {
      throw new BadRequestException('Selected executor must have expert role');
    }

    const amount = offerings.reduce((sum, offering) => sum + Number(offering.defaultPrice), 0);
    if (amount <= 0) {
      throw new BadRequestException('Order amount must be greater than zero');
    }

    return this.ordersService.checkoutExpertPosition(
      {
        positionId: dto.positionId,
        executorUserId: dto.executorUserId,
        offeringIds: uniqueOfferingIds,
        amount,
        comments: dto.comments,
        paymentMethod: dto.paymentMethod,
      },
      userId,
    );
  }
}
