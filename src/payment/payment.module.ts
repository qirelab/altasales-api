import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { Order } from '../orders/entities/order.entity';
import { CartModule } from '../cart/cart.module';
import { BalanceTransactionsModule } from '../balance-transactions/balance-transactions.module';
import { AuthModule } from '../auth/auth.module';
import { OrderNotificationsModule } from '../orders/order-notifications.module';
import { RecommendationsModule } from '../recommendations/recommendations.module';
import { RobokassaService } from './robokassa.service';
import { PaymentController } from './payment.controller';
import { PaymentService } from './payment.service';
import { Payment } from './entities/payment.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Payment, Order]),
    ConfigModule,
    CartModule,
    BalanceTransactionsModule,
    AuthModule,
    OrderNotificationsModule,
    RecommendationsModule,
  ],
  controllers: [PaymentController],
  providers: [PaymentService, RobokassaService],
  exports: [PaymentService],
})
export class PaymentModule {}
