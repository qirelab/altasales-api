import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';

@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const isProduction = config.get('NODE_ENV') === 'production';

        return {
          type: 'postgres',
          url: config.get<string>('DATABASE_URL'),
          ssl: false,
          entities: [__dirname + '/../**/*.entity{.ts,.js}'],
          migrations: [__dirname + '/../migrations/*{.ts,.js}'],
          migrationsTableName: 'migrations',
          synchronize: !isProduction,
          migrationsRun: isProduction,
        };
      },
    }),
  ],
})
export class DatabaseModule { }
