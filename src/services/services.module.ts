import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Category } from '../categories/entities/category.entity';
import { Order } from '../orders/entities/order.entity';
import { OrderItem } from '../orders/entities/order-item.entity';
import { User } from '../users/entities/user.entity';
import { ExpertProfile } from '../experts/entities/expert-profile.entity';
import { AuthModule } from '../auth/auth.module';
import { ServicePackage } from '../packages/entities/package.entity';
import { UsersModule } from '../users/users.module';
import { Service } from './entities/service.entity';
import { ServicesController } from './services.controller';
import { ServicesService } from './services.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Service, ServicePackage, Category, Order, OrderItem, User, ExpertProfile]),
    AuthModule,
    UsersModule,
  ],
  controllers: [ServicesController],
  providers: [ServicesService],
  exports: [ServicesService],
})
export class ServicesModule {}
