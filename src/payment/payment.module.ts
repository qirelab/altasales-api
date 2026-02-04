import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { Payment } from './entities/payment.entity';
import { Order } from '../orders/entities/order.entity';
import { PaymentService } from './payment.service';
import { PaymentController } from './payment.controller';
import { RobokassaService } from './robokassa.service';

@Module({
  imports: [TypeOrmModule.forFeature([Payment, Order]), ConfigModule],
  controllers: [PaymentController],
  providers: [PaymentService, RobokassaService],
  exports: [PaymentService],
})
export class PaymentModule { }
