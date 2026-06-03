import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAdminOrderNotificationsSeenAt1780500000000
implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "user"
      ADD COLUMN IF NOT EXISTS "adminOrderNotificationsSeenAt" timestamptz NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "order"
      ADD COLUMN IF NOT EXISTS "updatedAt" timestamptz NOT NULL DEFAULT now()
    `);

    await queryRunner.query(`
      UPDATE "user"
      SET "adminOrderNotificationsSeenAt" = now()
      WHERE role = 'admin' AND "adminOrderNotificationsSeenAt" IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "order"
      DROP COLUMN IF EXISTS "updatedAt"
    `);

    await queryRunner.query(`
      ALTER TABLE "user"
      DROP COLUMN IF EXISTS "adminOrderNotificationsSeenAt"
    `);
  }
}
