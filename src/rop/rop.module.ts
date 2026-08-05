import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { Order } from '../orders/entities/order.entity';
import { Questionnaire } from '../questionnaires/entities/questionnaire.entity';
import { User } from '../users/entities/user.entity';
import { RopController } from './rop.controller';
import { RopDashboardFilePartsService } from './rop-dashboard-file-parts.service';
import { RopDocumentLinkDownloadService } from './rop-document-link-download.service';
import { RopDocumentsService } from './rop-documents.service';
import { RopIndicatorsService } from './rop-indicators.service';
import { RopMeetingsService } from './rop-meetings.service';
import { RopProvisioningService } from './rop-provisioning.service';
import { RopSubscriptionService } from './rop-subscription.service';
import { RopService } from './rop.service';
import { RopTasksService } from './rop-tasks.service';

@Module({
  imports: [TypeOrmModule.forFeature([User, Questionnaire, Order]), AuthModule],
  controllers: [RopController],
  providers: [
    RopService,
    RopProvisioningService,
    RopSubscriptionService,
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
    RopSubscriptionService,
    RopDocumentsService,
    RopIndicatorsService,
    RopMeetingsService,
    RopTasksService,
  ],
})
export class RopModule {}
