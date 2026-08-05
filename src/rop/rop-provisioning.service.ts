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
    void this.ensureProvisionedForUser(userId, projectName).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`ROP provisioning failed for user ${userId}: ${message}`);
    });
  }

  async ensureProvisionedForUser(
    userId: string,
    projectName?: string,
  ): Promise<string | null> {
    const projectId = await this.ensureProjectForUser(userId, projectName);
    if (!projectId) {
      return null;
    }

    await this.ensureUserForUser(userId, projectId);
    return projectId;
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

  async ensureUserForUser(
    userId: string,
    projectId: string,
  ): Promise<string | null> {
    if (!this.ropService.isConfigured()) {
      return null;
    }

    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user?.email?.trim()) {
      this.logger.warn(`ROP user creation skipped: user ${userId} has no email`);
      return null;
    }

    if (user.role === UserRole.ADMIN) {
      return user.ropUserId;
    }

    if (user.ropUserId) {
      return user.ropUserId;
    }

    const created = await this.ropService.createUser({
      email: user.email,
      password: this.ropService.generateUserPassword(),
      projectId,
      firstName: user.name,
      lastName: user.lastName,
    });

    if (!created) {
      this.logger.log(
        `ROP user already exists for AltaSales user ${user.id}; skipping local ropUserId`,
      );
      return null;
    }

    await this.userRepository.update(user.id, { ropUserId: created.id });
    this.logger.log(`Created ROP user ${created.id} for user ${user.id}`);
    return created.id;
  }
}
