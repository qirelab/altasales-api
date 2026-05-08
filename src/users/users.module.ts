import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { OrdersModule } from '../orders/orders.module';
import { BalanceTransactionsModule } from '../balance-transactions/balance-transactions.module';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';

@Module({
  imports: [BalanceTransactionsModule, AuthModule, OrdersModule],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService, BalanceTransactionsModule],
})
export class UsersModule { }
