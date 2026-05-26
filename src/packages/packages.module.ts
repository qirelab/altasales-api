import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { Category } from '../categories/entities/category.entity';
import { Order } from '../orders/entities/order.entity';
import { OrderItem } from '../orders/entities/order-item.entity';
import { Service } from '../services/entities/service.entity';
import { ServicePackage } from './entities/package.entity';
import { PackagesController } from './packages.controller';
import { PackagesService } from './packages.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([ServicePackage, Service, Category, Order, OrderItem]),
    AuthModule,
  ],
  controllers: [PackagesController],
  providers: [PackagesService],
  exports: [PackagesService],
})
export class PackagesModule {}
