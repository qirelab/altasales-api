import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddFaqSortOrder1782400000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "faq"
      ADD COLUMN IF NOT EXISTS "sortOrder" int NOT NULL DEFAULT 0
    `);

    await queryRunner.query(`
      WITH ranked AS (
        SELECT id,
               ROW_NUMBER() OVER (PARTITION BY "categoryId" ORDER BY id) - 1 AS rn
        FROM "faq"
      )
      UPDATE "faq"
      SET "sortOrder" = ranked.rn
      FROM ranked
      WHERE "faq".id = ranked.id
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "faq" DROP COLUMN IF EXISTS "sortOrder"
    `);
  }
}
