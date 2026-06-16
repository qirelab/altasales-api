import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddRecommendationSource1780610000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "recommendation"
      ADD COLUMN IF NOT EXISTS "source" varchar(10)
    `);

    await queryRunner.query(`
      UPDATE "recommendation"
      SET "source" = CASE
        WHEN "generatedAt" IS NOT NULL THEN 'ai'
        ELSE 'manual'
      END
      WHERE "source" IS NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "recommendation"
      ALTER COLUMN "source" SET DEFAULT 'manual',
      ALTER COLUMN "source" SET NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "recommendation"
      DROP COLUMN IF EXISTS "source"
    `);
  }
}
