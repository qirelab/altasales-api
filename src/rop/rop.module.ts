import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { User } from '../users/entities/user.entity';
import { RopController } from './rop.controller';
import { RopDashboardFilePartsService } from './rop-dashboard-file-parts.service';
import { RopDocumentLinkDownloadService } from './rop-document-link-download.service';
import { RopDocumentsService } from './rop-documents.service';
import { RopIndicatorsService } from './rop-indicators.service';
import { RopMeetingsService } from './rop-meetings.service';
import { RopProvisioningService } from './rop-provisioning.service';
import { RopService } from './rop.service';
import { RopTasksService } from './rop-tasks.service';

@Module({
  imports: [TypeOrmModule.forFeature([User]), AuthModule],
  controllers: [RopController],
  providers: [
    RopService,
    RopProvisioningService,
    RopDocumentLinkDownloadService,
    RopDashboardFilePartsService,
    RopDocumentsService,
    RopIndicatorsService,
    RopMeetingsService,
    RopTasksService,
  ],
  exports: [
    RopService,
    RopProvisioningService,
    RopDocumentsService,
    RopIndicatorsService,
    RopMeetingsService,
    RopTasksService,
  ],
})
export class RopModule {}
