import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { BalanceService } from './balance.service';
import { User } from './entities/user.entity';
import { BalanceTransaction } from './entities/balance-transaction.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, BalanceTransaction]),
    AuthModule,
  ],
  controllers: [UsersController],
  providers: [UsersService, BalanceService],
  exports: [UsersService, BalanceService],
})
export class UsersModule { }
