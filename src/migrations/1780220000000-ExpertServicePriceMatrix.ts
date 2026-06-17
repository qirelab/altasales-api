import { MigrationInterface, QueryRunner } from 'typeorm';

export class ExpertServicePriceMatrix1780220000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "expert_position"
      ADD COLUMN IF NOT EXISTS "iconLabel" varchar(16),
      ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMPTZ
    `);

    await queryRunner.query(`
      ALTER TABLE "expert_position_member"
      ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMPTZ
    `);

    await queryRunner.query(`
      ALTER TABLE "expert_position_offering"
      ADD COLUMN IF NOT EXISTS "defaultPrice" decimal(12,2),
      ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMPTZ
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF to_regclass('public.expert_position_member_offering') IS NOT NULL THEN
          UPDATE "expert_position_offering" o
          SET "defaultPrice" = src."price"
          FROM (
            SELECT
              mo."offeringId",
              ROUND(AVG(mo."price")::numeric, 2) AS "price"
            FROM "expert_position_member_offering" mo
            GROUP BY mo."offeringId"
          ) src
          WHERE o."id" = src."offeringId" AND o."defaultPrice" IS NULL;
        ELSIF to_regclass('public.expert_service_price') IS NOT NULL THEN
          UPDATE "expert_position_offering" o
          SET "defaultPrice" = src."price"
          FROM (
            SELECT
              esp."groupServiceId",
              ROUND(AVG(esp."price")::numeric, 2) AS "price"
            FROM "expert_service_price" esp
            WHERE esp."price" IS NOT NULL
            GROUP BY esp."groupServiceId"
          ) src
          WHERE o."id" = src."groupServiceId" AND o."defaultPrice" IS NULL;
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      UPDATE "expert_position_offering"
      SET "defaultPrice" = 0
      WHERE "defaultPrice" IS NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "expert_position_offering"
      ALTER COLUMN "defaultPrice" SET NOT NULL
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF to_regclass('public.expert_service_price') IS NULL
          AND to_regclass('public.expert_position_member_offering') IS NOT NULL
        THEN
          ALTER TABLE "expert_position_member_offering" RENAME TO "expert_service_price";
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "expert_service_price" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "expertId" uuid NOT NULL,
        "groupServiceId" uuid NOT NULL,
        "price" decimal(12,2),
        CONSTRAINT "PK_expert_service_price_id" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      ALTER TABLE "expert_service_price"
      ADD COLUMN IF NOT EXISTS "expertId" uuid,
      ADD COLUMN IF NOT EXISTS "groupServiceId" uuid
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'expert_service_price'
            AND column_name = 'offeringId'
        ) AND NOT EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'expert_service_price'
            AND column_name = 'groupServiceId'
        ) THEN
          ALTER TABLE "expert_service_price" RENAME COLUMN "offeringId" TO "groupServiceId";
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'expert_service_price'
            AND column_name = 'offeringId'
        ) AND EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'expert_service_price'
            AND column_name = 'groupServiceId'
        ) THEN
          UPDATE "expert_service_price"
          SET "groupServiceId" = "offeringId"
          WHERE "groupServiceId" IS NULL;
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'expert_service_price'
            AND column_name = 'memberId'
        ) THEN
          UPDATE "expert_service_price" esp
          SET "expertId" = m."userId"
          FROM "expert_position_member" m
          WHERE esp."memberId" = m."id"
            AND esp."expertId" IS NULL;
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      DELETE FROM "expert_service_price"
      WHERE "expertId" IS NULL OR "groupServiceId" IS NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "expert_service_price"
      ALTER COLUMN "expertId" SET NOT NULL,
      ALTER COLUMN "groupServiceId" SET NOT NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "expert_service_price"
      DROP CONSTRAINT IF EXISTS "UQ_expert_position_member_offering_member_offering",
      DROP CONSTRAINT IF EXISTS "FK_expert_position_member_offering_member",
      DROP CONSTRAINT IF EXISTS "FK_expert_position_member_offering_offering"
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'expert_service_price'
            AND column_name = 'memberId'
        ) THEN
          ALTER TABLE "expert_service_price" DROP COLUMN "memberId";
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'expert_service_price'
            AND column_name = 'offeringId'
        ) THEN
          ALTER TABLE "expert_service_price" DROP COLUMN "offeringId";
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conname = 'UQ_expert_service_price_expert_service'
        ) THEN
          ALTER TABLE "expert_service_price"
            ADD CONSTRAINT "UQ_expert_service_price_expert_service"
            UNIQUE ("expertId", "groupServiceId");
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'FK_expert_service_price_expert'
        ) THEN
          ALTER TABLE "expert_service_price"
            ADD CONSTRAINT "FK_expert_service_price_expert"
            FOREIGN KEY ("expertId") REFERENCES "user"("id") ON DELETE CASCADE;
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'FK_expert_service_price_group_service'
        ) THEN
          ALTER TABLE "expert_service_price"
            ADD CONSTRAINT "FK_expert_service_price_group_service"
            FOREIGN KEY ("groupServiceId")
            REFERENCES "expert_position_offering"("id") ON DELETE CASCADE;
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      INSERT INTO "expert_service_price" ("expertId", "groupServiceId", "price")
      SELECT
        m."userId",
        o."id",
        o."defaultPrice"
      FROM "expert_position_member" m
      INNER JOIN "expert_position_offering" o ON o."positionId" = m."positionId"
      WHERE m."deletedAt" IS NULL
        AND o."deletedAt" IS NULL
      ON CONFLICT ("expertId", "groupServiceId") DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "expert_service_price"`);

    await queryRunner.query(`
      ALTER TABLE "expert_position_offering"
      DROP COLUMN IF EXISTS "deletedAt",
      DROP COLUMN IF EXISTS "defaultPrice"
    `);

    await queryRunner.query(`
      ALTER TABLE "expert_position_member"
      DROP COLUMN IF EXISTS "deletedAt"
    `);

    await queryRunner.query(`
      ALTER TABLE "expert_position"
      DROP COLUMN IF EXISTS "deletedAt",
      DROP COLUMN IF EXISTS "iconLabel"
    `);
  }
}
