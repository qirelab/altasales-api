import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { Order } from '../orders/entities/order.entity';
import { Payment } from './entities/payment.entity';
import { PaymentService } from './payment.service';
import { PaymentController } from './payment.controller';
import { RobokassaService } from './robokassa.service';
import { CartModule } from '../cart/cart.module';
import { BalanceTransactionsModule } from '../balance-transactions/balance-transactions.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Payment, Order]),
    ConfigModule,
    CartModule,
    BalanceTransactionsModule,
  ],
  controllers: [PaymentController],
  providers: [PaymentService, RobokassaService],
  exports: [PaymentService],
})
export class PaymentModule { }
