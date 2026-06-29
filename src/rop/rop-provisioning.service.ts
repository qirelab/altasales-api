import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../users/entities/user.entity';
import { UserRole } from '../users/entities/user-role.enum';
import { RopService } from './rop.service';

@Injectable()
export class RopProvisioningService {
  private readonly logger = new Logger(RopProvisioningService.name);
  private readonly ropUserRole: string;
  private readonly ropProjectRole: string;

  constructor(
    private readonly ropService: RopService,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {
    this.ropUserRole = process.env.ROP_USER_ROLE || 'rop';
    this.ropProjectRole = process.env.ROP_PROJECT_ROLE || 'rop';
  }

  scheduleProvision(userId: string): void {
    void this.ensureProvisioned(userId).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`ROP provisioning failed for user ${userId}: ${message}`);
    });
  }

  async ensureProvisioned(userId: string): Promise<string | null> {
    if (!this.ropService.isConfigured()) {
      return null;
    }

    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      this.logger.warn(`ROP provisioning skipped: user ${userId} not found`);
      return null;
    }

    if (user.role === UserRole.ADMIN) {
      return user.ropProjectId;
    }

    const projectId = await this.ensureProject(user);
    if (!projectId) {
      return null;
    }

    await this.ensureRopUser(user, projectId);
    return projectId;
  }

  private async ensureProject(user: User): Promise<string | null> {
    if (user.ropProjectId) {
      return user.ropProjectId;
    }

    const project = await this.ropService.createProject(`altasales-user-${user.id}`);
    await this.userRepository.update(user.id, { ropProjectId: project.id });
    this.logger.log(`Created ROP project ${project.id} for user ${user.id}`);

    return project.id;
  }

  private async ensureRopUser(user: User, projectId: string): Promise<void> {
    if (user.ropUserId) {
      return;
    }

    if (!user.email) {
      this.logger.warn(`ROP user provisioning skipped: user ${user.id} has no email`);
      return;
    }

    const fullName = [user.name, user.lastName].filter(Boolean).join(' ').trim() || null;
    const ropUser = await this.ropService.createUser({
      email: user.email,
      password: this.ropService.generateUserPassword(),
      first_name: user.name || null,
      last_name: user.lastName || null,
      phone_number: user.phoneNumber || null,
      full_name: fullName,
      role: this.ropUserRole,
      project_id: Number(projectId),
      project_role: this.ropProjectRole,
    });

    if (!ropUser) {
      this.logger.warn(
        `ROP user for ${user.email} was not created (likely already exists). ropUserId remains unset.`,
      );
      return;
    }

    await this.userRepository.update(user.id, { ropUserId: ropUser.id });
    this.logger.log(`Created ROP user ${ropUser.id} for AltaSales user ${user.id}`);
  }
}
