import { MigrationInterface, QueryRunner } from 'typeorm';

export class DropServiceContentSections1779419400000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "service"
      DROP COLUMN IF EXISTS "contentSections"
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "service"
      ADD COLUMN IF NOT EXISTS "contentSections" json NOT NULL DEFAULT '[]'
    `);
  }
}
