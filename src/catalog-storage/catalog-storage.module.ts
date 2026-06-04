import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from '../auth/auth.module';
import { CatalogStorageController } from './catalog-storage.controller';
import { CatalogStorageService } from './catalog-storage.service';

@Module({
  imports: [AuthModule, ConfigModule],
  controllers: [CatalogStorageController],
  providers: [CatalogStorageService],
  exports: [CatalogStorageService],
})
export class CatalogStorageModule {}
