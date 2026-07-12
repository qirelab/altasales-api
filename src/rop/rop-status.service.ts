import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { User } from '../users/entities/user.entity';
import { RopStatusResponseDto } from './dto/rop-status-response.dto';
import { RopService } from './rop.service';

@Injectable()
export class RopStatusService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly ropService: RopService,
  ) {}

  async getForUser(userId: string): Promise<RopStatusResponseDto> {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    return {
      configured: this.ropService.isConfigured(),
      projectId: user.ropProjectId,
    };
  }
}
