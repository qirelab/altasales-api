import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAppSettingsTable1782800000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "app_setting" (
        "key" varchar(100) PRIMARY KEY,
        "value" varchar(255) NOT NULL,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      INSERT INTO "app_setting" ("key", "value")
      VALUES ('vatRatePercent', '20')
      ON CONFLICT ("key") DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "app_setting"`);
  }
}
