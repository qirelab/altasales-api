import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../auth/auth.module';
import { User } from '../users/entities/user.entity';
import { RopController } from './rop.controller';
import { RopDocumentsService } from './rop-documents.service';
import { RopTasksService } from './rop-tasks.service';
import { RopProvisioningService } from './rop-provisioning.service';
import { RopStatusService } from './rop-status.service';
import { RopService } from './rop.service';

@Module({
  imports: [TypeOrmModule.forFeature([User]), AuthModule],
  controllers: [RopController],
  providers: [RopService, RopProvisioningService, RopDocumentsService, RopTasksService, RopStatusService],
  exports: [RopService, RopProvisioningService, RopDocumentsService, RopTasksService, RopStatusService],
})
export class RopModule {}
