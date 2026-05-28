import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPackageDeletedAt1779810000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "service_package"
      ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMPTZ NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "service_package"
      DROP COLUMN IF EXISTS "deletedAt"
    `);
  }
}
