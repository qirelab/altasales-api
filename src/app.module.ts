import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { UsersModule } from './users/users.module';
import { DatabaseModule } from './config/database.module.js';
import { AuthModule } from './auth/auth.module';
import { ServicesModule } from './services/services.module';
import { WebSocketModule } from './websocket/websocket.module.js';

@Module({
  imports: [
    UsersModule,
    DatabaseModule,
    ConfigModule.forRoot({ isGlobal: true }),
    AuthModule,
    ServicesModule,
    WebSocketModule,
  ],
})
export class AppModule { }
