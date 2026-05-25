import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BalanceTransactionsModule } from '../balance-transactions/balance-transactions.module';
import { User } from '../users/entities/user.entity';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { FirebaseService } from './firebase/firebase.service';
import { SessionGuard } from './guards/session.guard';
import { RolesGuard } from './guards/roles.guard';

@Module({
  imports: [TypeOrmModule.forFeature([User]), BalanceTransactionsModule],
  controllers: [AuthController],
  providers: [AuthService, FirebaseService, SessionGuard, RolesGuard],
  exports: [AuthService, FirebaseService, SessionGuard, RolesGuard],
})
export class AuthModule {}
