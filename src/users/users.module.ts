import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { OrdersModule } from '../orders/orders.module';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { BalanceModule } from './balance.module';

@Module({
  imports: [BalanceModule, AuthModule, OrdersModule],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService, BalanceModule],
})
export class UsersModule { }
