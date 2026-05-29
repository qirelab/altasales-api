import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddServiceDeletedAt1779800000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "service"
      ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMPTZ NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "service"
      DROP COLUMN IF EXISTS "deletedAt"
    `);
  }
}
