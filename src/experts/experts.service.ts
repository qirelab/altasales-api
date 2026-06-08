import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { UserRole } from '../users/entities/user-role.enum';
import { ExpertPosition } from './entities/expert-position.entity';
import { ExpertPositionMember } from './entities/expert-position-member.entity';
import { ExpertPositionMemberOffering } from './entities/expert-position-member-offering.entity';
import { ExpertPositionOffering } from './entities/expert-position-offering.entity';

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
    @InjectRepository(ExpertPositionMemberOffering)
    private readonly memberOfferingRepository: Repository<ExpertPositionMemberOffering>,
  ) { }

  async findAllPositions(): Promise<ExpertPositionListItem[]> {
    const positions = await this.positionRepository.find({
      order: { createdAt: 'ASC' },
      relations: ['offerings', 'members'],
    });

    const positionIds = positions.map((p) => p.id);
    const memberOfferings = positionIds.length > 0
      ? await this.memberOfferingRepository
        .createQueryBuilder('mo')
        .innerJoin('mo.member', 'member')
        .select(['mo.price AS price', 'member.positionId AS "positionId"'])
        .where('member.positionId IN (:...positionIds)', { positionIds })
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
      where: { id },
      relations: ['offerings', 'members', 'members.user'],
    });
    if (!position) {
      throw new NotFoundException(`Expert position with id ${id} not found`);
    }

    const positionOfferings = sortOfferingsByName(position.offerings ?? []);
    const offerings = positionOfferings.map((offering) => ({
      id: offering.id,
      name: offering.name,
      description: offering.description,
    }));

    const executors = await Promise.all(
      (position.members ?? [])
        .filter((member) => Boolean(member.user))
        .map(async (member) => {
          const prices = await this.getMemberOfferingPrices(member.id, positionOfferings);
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
      executors,
    };
  }

  async resolveCheckoutLines(input: ExpertCheckoutResolveInput): Promise<ExpertCheckoutResolveResult> {
    const uniqueOfferingIds = [...new Set(input.offeringIds)];
    if (uniqueOfferingIds.length !== input.offeringIds.length) {
      throw new BadRequestException('Duplicate offering IDs are not allowed');
    }

    const position = await this.positionRepository.findOne({
      where: { id: input.positionId },
      relations: ['offerings'],
    });
    if (!position) {
      throw new NotFoundException(`Expert position with id ${input.positionId} not found`);
    }

    const positionOfferings = position.offerings ?? [];
    const offerings = positionOfferings.filter((offering) => uniqueOfferingIds.includes(offering.id));
    if (offerings.length !== uniqueOfferingIds.length) {
      throw new BadRequestException('One or more offerings do not belong to the selected position');
    }

    const member = await this.memberRepository.findOne({
      where: { positionId: input.positionId, userId: input.executorUserId },
      relations: ['user'],
    });
    if (!member?.user) {
      throw new ConflictException('Selected executor is not assigned to this position');
    }
    if (member.user.role !== UserRole.EXPERT) {
      throw new BadRequestException('Selected executor must have expert role');
    }

    const memberPrices = await this.memberOfferingRepository.find({
      where: { memberId: member.id, offeringId: In(uniqueOfferingIds) },
    });
    if (memberPrices.length !== uniqueOfferingIds.length) {
      throw new BadRequestException('У исполнителя не заданы цены на выбранные услуги');
    }

    const offeringLines = memberPrices.map((entry) => ({
      offeringId: entry.offeringId,
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
    const entries = await this.memberOfferingRepository.find({
      where: { memberId },
      relations: ['offering'],
    });
    const priceByOfferingId = new Map(entries.map((entry) => [entry.offeringId, Number(entry.price)]));

    return sortOfferingsByName(positionOfferings)
      .filter((offering) => priceByOfferingId.has(offering.id))
      .map((offering) => ({
        offeringId: offering.id,
        name: offering.name,
        price: priceByOfferingId.get(offering.id)!,
      }));
  }
}
