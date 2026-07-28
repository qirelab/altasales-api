import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { User } from '../users/entities/user.entity';
import { RopController } from './rop.controller';
import { RopDocumentLinkDownloadService } from './rop-document-link-download.service';
import { RopDocumentsService } from './rop-documents.service';
import { RopProvisioningService } from './rop-provisioning.service';
import { RopService } from './rop.service';

@Module({
  imports: [TypeOrmModule.forFeature([User]), AuthModule],
  controllers: [RopController],
  providers: [
    RopService,
    RopProvisioningService,
    RopDocumentLinkDownloadService,
    RopDocumentsService,
  ],
  exports: [RopService, RopProvisioningService, RopDocumentsService],
})
export class RopModule {}
