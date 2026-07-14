import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../auth/auth.module';
import { User } from '../users/entities/user.entity';
import { RopController } from './rop.controller';
import { RopDocumentsService } from './rop-documents.service';
import { RopIndicatorsService } from './rop-indicators.service';
import { RopTasksService } from './rop-tasks.service';
import { RopProvisioningService } from './rop-provisioning.service';
import { RopService } from './rop.service';

@Module({
  imports: [TypeOrmModule.forFeature([User]), AuthModule],
  controllers: [RopController],
  providers: [RopService, RopProvisioningService, RopDocumentsService, RopIndicatorsService, RopTasksService],
  exports: [RopService, RopProvisioningService, RopDocumentsService, RopIndicatorsService, RopTasksService],
})
export class RopModule {}
