import { MigrationInterface, QueryRunner } from 'typeorm';

export class DedupePackagesAndAddUniqueName1782820000000
implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      WITH normalized AS (
        SELECT
          id,
          LOWER(TRIM(REGEXP_REPLACE(name, '\\s+', ' ', 'g'))) AS norm_name,
          (SELECT COUNT(*)
             FROM "package_categories" pc
             WHERE pc."packageId" = sp.id) AS category_count
        FROM "service_package" sp
        WHERE sp."deletedAt" IS NULL
      ),
      ranked AS (
        SELECT
          id,
          ROW_NUMBER() OVER (
            PARTITION BY norm_name
            ORDER BY category_count DESC, id ASC
          ) AS rn
        FROM normalized
      )
      UPDATE "service_package" sp
      SET "deletedAt" = now()
      WHERE sp.id IN (SELECT id FROM ranked WHERE rn > 1);
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS
        "UQ_service_package_name_lower_active"
      ON "service_package" (LOWER(name))
      WHERE "deletedAt" IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "UQ_service_package_name_lower_active"
    `);
  }
}
