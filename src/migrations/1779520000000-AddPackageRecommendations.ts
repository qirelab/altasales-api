import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPackageRecommendations1779520000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "recommendation"
      ADD COLUMN IF NOT EXISTS "packageId" uuid NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "recommendation"
      ALTER COLUMN "serviceId" DROP NOT NULL
    `);

    await queryRunner.query(`
      DROP INDEX IF EXISTS "UQ_recommendation_userId_serviceId"
    `);

    await queryRunner.query(`
      ALTER TABLE "recommendation"
      DROP CONSTRAINT IF EXISTS "UQ_recommendation_userId_serviceId"
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'FK_recommendation_packageId_service_package'
        ) THEN
          ALTER TABLE "recommendation"
            ADD CONSTRAINT "FK_recommendation_packageId_service_package"
            FOREIGN KEY ("packageId") REFERENCES "service_package"("id")
            ON DELETE CASCADE;
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_recommendation_user_service_not_null"
      ON "recommendation" ("userId", "serviceId")
      WHERE "serviceId" IS NOT NULL
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_recommendation_user_package_not_null"
      ON "recommendation" ("userId", "packageId")
      WHERE "packageId" IS NOT NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "recommendation"
      DROP CONSTRAINT IF EXISTS "CHK_recommendation_service_xor_package"
    `);

    await queryRunner.query(`
      ALTER TABLE "recommendation"
      ADD CONSTRAINT "CHK_recommendation_service_xor_package"
      CHECK (("serviceId" IS NOT NULL) <> ("packageId" IS NOT NULL))
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "recommendation"
      DROP CONSTRAINT IF EXISTS "CHK_recommendation_service_xor_package"
    `);

    await queryRunner.query(`
      DROP INDEX IF EXISTS "UQ_recommendation_user_package_not_null"
    `);

    await queryRunner.query(`
      DROP INDEX IF EXISTS "UQ_recommendation_user_service_not_null"
    `);

    await queryRunner.query(`
      ALTER TABLE "recommendation"
      DROP CONSTRAINT IF EXISTS "FK_recommendation_packageId_service_package"
    `);

    await queryRunner.query(`
      DELETE FROM "recommendation"
      WHERE "serviceId" IS NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "recommendation"
      ALTER COLUMN "serviceId" SET NOT NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "recommendation"
      DROP COLUMN IF EXISTS "packageId"
    `);
  }
}
