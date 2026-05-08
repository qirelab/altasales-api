import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../users/entities/user.entity';
import { BalanceTransaction } from './entities/balance-transaction.entity';
import { BalanceService } from './balance.service';

@Module({
  imports: [TypeOrmModule.forFeature([User, BalanceTransaction])],
  providers: [BalanceService],
  exports: [BalanceService, TypeOrmModule],
})
export class BalanceTransactionsModule { }
