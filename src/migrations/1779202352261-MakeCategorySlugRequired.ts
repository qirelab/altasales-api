import { MigrationInterface, QueryRunner } from "typeorm";

export class MakeCategorySlugRequired1779202352261 implements MigrationInterface {

    public async up(queryRunner: QueryRunner): Promise<void> {
        // 1. Ensure slug column exists (older schema may have been created without it)
        await queryRunner.query(`
            ALTER TABLE "category"
            ADD COLUMN IF NOT EXISTS "slug" character varying(120)
        `);

        // 2. Backfill NULL slugs with a deterministic value based on UUID prefix
        await queryRunner.query(`
            UPDATE "category"
            SET "slug" = 'category-' || substring("id"::text, 1, 8)
            WHERE "slug" IS NULL
        `);

        // 3. Unique index (idempotent — doesn't conflict if an older sync already created one)
        await queryRunner.query(`
            CREATE UNIQUE INDEX IF NOT EXISTS "UQ_category_slug" ON "category" ("slug")
        `);

        // 4. NOT NULL
        await queryRunner.query(`
            ALTER TABLE "category"
            ALTER COLUMN "slug" SET NOT NULL
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE "category"
            ALTER COLUMN "slug" DROP NOT NULL
        `);
        await queryRunner.query(`
            DROP INDEX IF EXISTS "UQ_category_slug"
        `);
    }

}
