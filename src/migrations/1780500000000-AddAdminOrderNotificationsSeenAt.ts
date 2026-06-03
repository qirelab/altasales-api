import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAdminOrderNotificationsSeenAt1780500000000
implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "user"
      ADD COLUMN IF NOT EXISTS "adminOrderNotificationsSeenAt" timestamptz NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "user"
      DROP COLUMN IF EXISTS "adminOrderNotificationsSeenAt"
    `);
  }
}
