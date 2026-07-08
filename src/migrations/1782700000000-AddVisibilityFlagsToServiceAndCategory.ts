import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddVisibilityFlagsToServiceAndCategory1782700000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "service"
      ADD COLUMN IF NOT EXISTS "isHidden" boolean NOT NULL DEFAULT false
    `);
    await queryRunner.query(`
      ALTER TABLE "category"
      ADD COLUMN IF NOT EXISTS "isHidden" boolean NOT NULL DEFAULT false
    `);
    await queryRunner.query(`
      ALTER TABLE "service_package"
      ADD COLUMN IF NOT EXISTS "isHidden" boolean NOT NULL DEFAULT false
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "service"
      DROP COLUMN IF EXISTS "isHidden"
    `);
    await queryRunner.query(`
      ALTER TABLE "category"
      DROP COLUMN IF EXISTS "isHidden"
    `);
    await queryRunner.query(`
      ALTER TABLE "service_package"
      DROP COLUMN IF EXISTS "isHidden"
    `);
  }
}
