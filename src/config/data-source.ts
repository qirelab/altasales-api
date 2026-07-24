import 'dotenv/config';
import { DataSource } from 'typeorm';

export const AppDataSource = new DataSource({
  type: 'postgres',
  url: process.env.DATABASE_URL,
  ssl: false,
  entities: [__dirname + '/../**/*.entity{.ts,.js}'],
  migrations: [__dirname + '/../migrations/*{.ts,.js}'],
  migrationsTableName: 'migrations',
  // Required for migrations that opt out of the outer transaction via
  // `public transaction = false` (e.g. ALTER TYPE ... ADD VALUE, which
  // cannot run inside a transaction). The default 'all' mode rejects
  // per-migration overrides at startup.
  migrationsTransactionMode: 'each',
});
