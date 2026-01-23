import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { UsersModule } from './users/users.module';
import { DatabaseModule } from './config/database.module.js';

@Module({
  imports: [UsersModule, DatabaseModule, UsersModule, ConfigModule.forRoot({ isGlobal: true })],
})
export class AppModule { }
