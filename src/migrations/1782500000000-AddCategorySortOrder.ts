import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCategorySortOrder1782500000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "category"
      ADD COLUMN IF NOT EXISTS "sortOrder" int NOT NULL DEFAULT 0
    `);

    await queryRunner.query(`
      WITH ranked AS (
        SELECT id,
               ROW_NUMBER() OVER (ORDER BY id) - 1 AS rn
        FROM "category"
      )
      UPDATE "category"
      SET "sortOrder" = ranked.rn
      FROM ranked
      WHERE "category".id = ranked.id
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "category" DROP COLUMN IF EXISTS "sortOrder"
    `);
  }
}
