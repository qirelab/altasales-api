import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../users/entities/user.entity';
import { RopProvisioningService } from './rop-provisioning.service';
import { RopService } from './rop.service';

@Module({
  imports: [TypeOrmModule.forFeature([User])],
  providers: [RopService, RopProvisioningService],
  exports: [RopService, RopProvisioningService],
})
export class RopModule {}
