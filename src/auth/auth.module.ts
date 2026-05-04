import { Module } from '@nestjs/common';
import { BalanceModule } from '../users/balance.module';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { FirebaseService } from './firebase/firebase.service';
import { SessionGuard } from './guards/session.guard';
import { RolesGuard } from './guards/roles.guard';

@Module({
  imports: [BalanceModule],
  controllers: [AuthController],
  providers: [AuthService, FirebaseService, SessionGuard, RolesGuard],
  exports: [AuthService, SessionGuard, RolesGuard],
})
export class AuthModule {}
