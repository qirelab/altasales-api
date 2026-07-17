import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../users/entities/user.entity';
import { UserRole } from '../users/entities/user-role.enum';
import { RopService } from './rop.service';

@Injectable()
export class RopProvisioningService {
  private readonly logger = new Logger(RopProvisioningService.name);

  constructor(
    private readonly ropService: RopService,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  scheduleProjectCreation(userId: string, projectName?: string): void {
    void this.ensureProjectForUser(userId, projectName).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`ROP project creation failed for user ${userId}: ${message}`);
    });
  }

  async ensureProjectForUser(userId: string, projectName?: string): Promise<string | null> {
    if (!this.ropService.isConfigured()) {
      return null;
    }

    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      this.logger.warn(`ROP project creation skipped: user ${userId} not found`);
      return null;
    }

    if (user.role === UserRole.ADMIN) {
      return user.ropProjectId;
    }

    if (user.ropProjectId) {
      return user.ropProjectId;
    }

    const name = projectName?.trim() || `altasales-user-${user.id}`;
    const project = await this.ropService.createProject(name);
    await this.userRepository.update(user.id, { ropProjectId: project.id });
    this.logger.log(`Created ROP project ${project.id} for user ${user.id}`);

    return project.id;
  }
}
