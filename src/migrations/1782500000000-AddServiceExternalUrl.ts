import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddServiceExternalUrl1782500000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "service"
      ADD COLUMN IF NOT EXISTS "externalUrl" varchar NULL
    `);

    await queryRunner.query(`
      UPDATE "service"
      SET "externalUrl" = 'https://ropsharing.dev/indicators/interim-report'
      WHERE "name" = 'ИИ анализ дашборда'
        AND "externalUrl" IS NULL
        AND "deletedAt" IS NULL
    `);

    await queryRunner.query(`
      UPDATE "service"
      SET "externalUrl" = 'https://ropsharing.dev/documents'
      WHERE "name" = 'ИИ анализ документов'
        AND "externalUrl" IS NULL
        AND "deletedAt" IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "service" DROP COLUMN IF EXISTS "externalUrl"
    `);
  }
}
