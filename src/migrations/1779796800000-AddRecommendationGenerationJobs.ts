import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddRecommendationGenerationJobs1779796800000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE EXTENSION IF NOT EXISTS "uuid-ossp"
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "recommendation_generation_job" (
        "id"          uuid         NOT NULL DEFAULT uuid_generate_v4(),
        "userId"      uuid         NOT NULL,
        "status"      varchar(20)  NOT NULL DEFAULT 'pending',
        "request"     jsonb                 DEFAULT NULL,
        "result"      jsonb                 DEFAULT NULL,
        "error"       text                  DEFAULT NULL,
        "startedAt"   timestamptz           DEFAULT NULL,
        "completedAt" timestamptz           DEFAULT NULL,
        "createdAt"   timestamptz  NOT NULL DEFAULT now(),
        "updatedAt"   timestamptz  NOT NULL DEFAULT now(),
        CONSTRAINT "PK_recommendation_generation_job" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'FK_recommendation_generation_job_userId'
        ) THEN
          ALTER TABLE "recommendation_generation_job"
            ADD CONSTRAINT "FK_recommendation_generation_job_userId"
            FOREIGN KEY ("userId") REFERENCES "user"("id")
            ON DELETE CASCADE;
        END IF;
      END $$;
    `);

    const recommendationColumns = [
      { name: 'priority',          type: 'varchar(20)',  default: "'medium'" },
      { name: 'rationale',         type: 'text',         default: 'NULL' },
      { name: 'dependencyIds',     type: 'jsonb',        default: "'[]'" },
      { name: 'diagnosticSignals', type: 'jsonb',        default: "'[]'" },
      { name: 'generatedAt',       type: 'timestamptz',  default: 'NULL' },
      { name: 'packageId',         type: 'uuid',         default: 'NULL' },
    ];

    for (const col of recommendationColumns) {
      await queryRunner.query(`
        ALTER TABLE "recommendation"
        ADD COLUMN IF NOT EXISTS "${col.name}" ${col.type} DEFAULT ${col.default}
      `);
    }

    await queryRunner.query(`
      ALTER TABLE "user"
      ADD COLUMN IF NOT EXISTS "notificationsSeenAt" timestamptz DEFAULT NULL
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'user'
            AND column_name = 'notificationsSeenAt'
            AND data_type = 'timestamp without time zone'
        ) THEN
          ALTER TABLE "user"
            ALTER COLUMN "notificationsSeenAt" TYPE timestamptz
            USING "notificationsSeenAt" AT TIME ZONE 'UTC';
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      ALTER TABLE "recommendation"
      ALTER COLUMN "serviceId" DROP NOT NULL
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'recommendation'
            AND column_name = 'createdAt'
            AND data_type = 'timestamp without time zone'
        ) THEN
          ALTER TABLE "recommendation"
            ALTER COLUMN "createdAt" TYPE timestamptz
            USING "createdAt" AT TIME ZONE 'UTC';
        END IF;

        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'recommendation'
            AND column_name = 'updatedAt'
            AND data_type = 'timestamp without time zone'
        ) THEN
          ALTER TABLE "recommendation"
            ALTER COLUMN "updatedAt" TYPE timestamptz
            USING "updatedAt" AT TIME ZONE 'UTC';
        END IF;
      END $$;
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
      DELETE FROM "recommendation"
      WHERE "serviceId" IS NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "recommendation"
      ALTER COLUMN "serviceId" SET NOT NULL
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

    const recommendationColumns = [
      'packageId',
      'generatedAt',
      'diagnosticSignals',
      'dependencyIds',
      'rationale',
      'priority',
    ];

    for (const colName of recommendationColumns) {
      await queryRunner.query(`
        ALTER TABLE "recommendation"
        DROP COLUMN IF EXISTS "${colName}"
      `);
    }

    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'user'
            AND column_name = 'notificationsSeenAt'
            AND data_type = 'timestamp with time zone'
        ) THEN
          ALTER TABLE "user"
            ALTER COLUMN "notificationsSeenAt" TYPE timestamp
            USING "notificationsSeenAt" AT TIME ZONE 'UTC';
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      ALTER TABLE "recommendation_generation_job"
      DROP CONSTRAINT IF EXISTS "FK_recommendation_generation_job_userId"
    `);

    await queryRunner.query(`
      DROP TABLE IF EXISTS "recommendation_generation_job"
    `);
  }
}
