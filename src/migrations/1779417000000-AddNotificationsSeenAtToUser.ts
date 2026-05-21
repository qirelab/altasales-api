import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddNotificationsSeenAtToUser1779417000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "user"
      ADD COLUMN IF NOT EXISTS "notificationsSeenAt" timestamp NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "user"
      DROP COLUMN IF EXISTS "notificationsSeenAt"
    `);
  }
}
