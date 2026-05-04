import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BalanceService } from './balance.service';
import { User } from './entities/user.entity';
import { BalanceTransaction } from './entities/balance-transaction.entity';

@Module({
  imports: [TypeOrmModule.forFeature([User, BalanceTransaction])],
  providers: [BalanceService],
  exports: [BalanceService, TypeOrmModule],
})
export class BalanceModule {}
