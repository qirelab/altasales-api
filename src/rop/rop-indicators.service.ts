import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { User } from '../users/entities/user.entity';
import {
  RopBenchmarkDecompositionQueryDto,
  RopIntervalDashboardQueryDto,
  RopMonthDashboardQueryDto,
} from './dto/rop-indicators-query.dto';
import { RopService } from './rop.service';

@Injectable()
export class RopIndicatorsService {
  constructor(
    private readonly ropService: RopService,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  async getMonthDashboardForUser(
    userId: string,
    query: RopMonthDashboardQueryDto,
  ): Promise<Record<string, unknown>> {
    const projectId = await this.requireProjectId(userId);
    return this.ropService.getDepartmentMonthDashboard(
      projectId,
      query.departmentId,
      query.startDate,
      query.endDate,
    );
  }

  async getIntervalDashboardForUser(
    userId: string,
    query: RopIntervalDashboardQueryDto,
  ): Promise<Record<string, unknown>> {
    const projectId = await this.requireProjectId(userId);
    return this.ropService.getDepartmentIntervalDashboard(
      projectId,
      query.departmentId,
      query.startDate,
      query.endDate,
    );
  }

  async getBenchmarkDecompositionForUser(
    userId: string,
    query: RopBenchmarkDecompositionQueryDto,
  ): Promise<Record<string, unknown>> {
    const projectId = await this.requireProjectId(userId);
    return this.ropService.getDepartmentBenchmarkDecomposition(
      projectId,
      query.departmentId,
      query.analyzeDate,
    );
  }

  private async getProjectId(userId: string): Promise<string | null> {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    return user.ropProjectId;
  }

  private async requireProjectId(userId: string): Promise<string> {
    const projectId = await this.getProjectId(userId);
    if (projectId) {
      return projectId;
    }

    if (!this.ropService.isConfigured()) {
      throw new InternalServerErrorException('ROP API not configured');
    }

    throw new BadRequestException('Сначала заполните анкету');
  }
}
