import { MigrationInterface, QueryRunner } from 'typeorm';

export class CategoryManyToManyForServiceAndPackage1782600000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "package_categories" (
        "packageId" uuid NOT NULL,
        "categoryId" uuid NOT NULL,
        CONSTRAINT "PK_package_categories" PRIMARY KEY ("packageId", "categoryId")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_package_categories_packageId"
        ON "package_categories" ("packageId")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_package_categories_categoryId"
        ON "package_categories" ("categoryId")
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'FK_package_categories_package'
        ) THEN
          ALTER TABLE "package_categories"
            ADD CONSTRAINT "FK_package_categories_package"
            FOREIGN KEY ("packageId") REFERENCES "service_package"("id") ON DELETE CASCADE;
        END IF;
      END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'FK_package_categories_category'
        ) THEN
          ALTER TABLE "package_categories"
            ADD CONSTRAINT "FK_package_categories_category"
            FOREIGN KEY ("categoryId") REFERENCES "category"("id") ON DELETE CASCADE;
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'service_package' AND column_name = 'categoryId'
        ) THEN
          INSERT INTO "package_categories" ("packageId", "categoryId")
          SELECT sp."id", sp."categoryId"
          FROM "service_package" sp
          WHERE sp."categoryId" IS NOT NULL
          ON CONFLICT DO NOTHING;
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      ALTER TABLE "service_package" DROP COLUMN IF EXISTS "categoryId"
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "service_package" ADD COLUMN IF NOT EXISTS "categoryId" uuid NULL
    `);
    await queryRunner.query(`
      UPDATE "service_package" sp
      SET "categoryId" = pc."categoryId"
      FROM "package_categories" pc
      WHERE pc."packageId" = sp."id" AND sp."categoryId" IS NULL
    `);
    await queryRunner.query(`DROP TABLE IF EXISTS "package_categories"`);
  }
}
