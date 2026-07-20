import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../users/entities/user.entity';
import { ListRopTasksQueryDto } from './dto/list-rop-tasks-query.dto';
import { RopTaskResponseDto } from './dto/rop-task-response.dto';
import { mapRopTask } from './rop-task.mapper';
import { RopService } from './rop.service';

@Injectable()
export class RopTasksService {
  constructor(
    private readonly ropService: RopService,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  async listForUser(userId: string, query: ListRopTasksQueryDto): Promise<RopTaskResponseDto[]> {
    const projectId = await this.getProjectId(userId);
    if (!projectId) {
      return [];
    }

    const tasks = await this.ropService.listTasks(projectId, {
      startDate: query.startDate,
      endDate: query.endDate,
    });
    return tasks.map(mapRopTask);
  }

  async getForUser(userId: string, taskId: string): Promise<RopTaskResponseDto> {
    const projectId = await this.requireProjectId(userId);
    const task = await this.ropService.getTask(projectId, taskId);
    return mapRopTask(task);
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
