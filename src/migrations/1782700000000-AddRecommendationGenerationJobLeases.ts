import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddRecommendationGenerationJobLeases1782700000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "recommendation_generation_job"
        ADD COLUMN IF NOT EXISTS "idempotencyKey" varchar(255) DEFAULT NULL,
        ADD COLUMN IF NOT EXISTS "leaseToken" uuid DEFAULT NULL,
        ADD COLUMN IF NOT EXISTS "leaseExpiresAt" timestamptz DEFAULT NULL
    `);

    await queryRunner.query(`
      UPDATE "recommendation_generation_job"
      SET "leaseExpiresAt" = CASE
        WHEN "updatedAt" < now() - interval '10 minutes'
          THEN "updatedAt"
        ELSE now() + interval '10 minutes'
      END
      WHERE "status" = 'processing' AND "leaseExpiresAt" IS NULL
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS
        "UQ_recommendation_generation_job_user_idempotency"
      ON "recommendation_generation_job" ("userId", "idempotencyKey")
      WHERE "idempotencyKey" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "UQ_recommendation_generation_job_user_idempotency"
    `);

    await queryRunner.query(`
      ALTER TABLE "recommendation_generation_job"
        DROP COLUMN IF EXISTS "leaseExpiresAt",
        DROP COLUMN IF EXISTS "leaseToken",
        DROP COLUMN IF EXISTS "idempotencyKey"
    `);
  }
}