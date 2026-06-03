import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PaymentModule } from '../payment/payment.module';
import { AuthModule } from '../auth/auth.module';
import { BalanceTransactionsModule } from '../balance-transactions/balance-transactions.module';
import { CartModule } from '../cart/cart.module';
import { ServicePackage } from '../packages/entities/package.entity';
import { Service } from '../services/entities/service.entity';
import { Order } from './entities/order.entity';
import { OrderItem } from './entities/order-item.entity';
import { OrderItemSubItem } from './entities/order-item-sub-item.entity';
import { Recommendation } from '../recommendations/entities/recommendation.entity';
import { ExpertPositionOffering } from '../experts/entities/expert-position-offering.entity';
import { OrdersService } from './orders.service';
import { OrdersController } from './orders.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Order,
      OrderItem,
      OrderItemSubItem,
      Recommendation,
      Service,
      ServicePackage,
      ExpertPositionOffering,
    ]),
    PaymentModule,
    AuthModule,
    BalanceTransactionsModule,
    CartModule,
  ],
  controllers: [OrdersController],
  providers: [OrdersService],
  exports: [TypeOrmModule, OrdersService],
})
export class OrdersModule { }
