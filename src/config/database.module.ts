import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';

@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        host: config.get<string>('DB_HOST') || 'localhost',
        port: Number(config.get<string>('DB_PORT') || 5432),
        username: config.get<string>('DB_USER') || 'altasales_user',
        password: config.get<string>('DB_PASSWORD') || 'maimchik002',
        database: config.get<string>('DB_NAME') || 'altasales',
        ssl: false,
        entities: [__dirname + '/../**/*.entity{.ts,.js}'],
        synchronize: !(config.get('NODE_ENV') === 'production'),
      }),
    }),
  ],
})
export class DatabaseModule {}
