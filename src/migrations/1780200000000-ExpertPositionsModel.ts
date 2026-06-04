import { MigrationInterface, QueryRunner } from 'typeorm';

export class ExpertPositionsModel1780200000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "expert_position" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "name" varchar(120) NOT NULL,
        "description" text NOT NULL,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_expert_position_id" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "expert_position_offering" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "positionId" uuid NOT NULL,
        "name" varchar(255) NOT NULL,
        "description" text,
        CONSTRAINT "PK_expert_position_offering_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_expert_position_offering_position_name" UNIQUE ("positionId", "name"),
        CONSTRAINT "FK_expert_position_offering_position"
          FOREIGN KEY ("positionId") REFERENCES "expert_position"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "expert_position_member" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "positionId" uuid NOT NULL,
        "userId" uuid NOT NULL,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_expert_position_member_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_expert_position_member_position_user" UNIQUE ("positionId", "userId"),
        CONSTRAINT "FK_expert_position_member_position"
          FOREIGN KEY ("positionId") REFERENCES "expert_position"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_expert_position_member_user"
          FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "expert_position_member_offering" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "memberId" uuid NOT NULL,
        "offeringId" uuid NOT NULL,
        "price" decimal(12,2) NOT NULL,
        CONSTRAINT "PK_expert_position_member_offering_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_expert_position_member_offering_member_offering"
          UNIQUE ("memberId", "offeringId"),
        CONSTRAINT "FK_expert_position_member_offering_member"
          FOREIGN KEY ("memberId") REFERENCES "expert_position_member"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_expert_position_member_offering_offering"
          FOREIGN KEY ("offeringId") REFERENCES "expert_position_offering"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      ALTER TABLE "order_item"
      ADD COLUMN IF NOT EXISTS "expertPositionId" uuid,
      ADD COLUMN IF NOT EXISTS "executorUserId" uuid
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'FK_order_item_expertPositionId'
        ) THEN
          ALTER TABLE "order_item"
            ADD CONSTRAINT "FK_order_item_expertPositionId"
            FOREIGN KEY ("expertPositionId") REFERENCES "expert_position"("id") ON DELETE RESTRICT;
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'FK_order_item_executorUserId'
        ) THEN
          ALTER TABLE "order_item"
            ADD CONSTRAINT "FK_order_item_executorUserId"
            FOREIGN KEY ("executorUserId") REFERENCES "user"("id") ON DELETE RESTRICT;
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      ALTER TABLE "order_item" DROP CONSTRAINT IF EXISTS "CHK_order_item_service_xor_package"
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'CHK_order_item_product_type'
        ) THEN
          ALTER TABLE "order_item"
            ADD CONSTRAINT "CHK_order_item_product_type" CHECK (
              (("serviceId" IS NOT NULL)::int)
              + (("packageId" IS NOT NULL)::int)
              + (("expertPositionId" IS NOT NULL)::int) = 1
            );
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_order_item_order_expert_position_not_null"
      ON "order_item" ("orderId", "expertPositionId")
      WHERE "expertPositionId" IS NOT NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "order_item_sub_item"
      ALTER COLUMN "serviceId" DROP NOT NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "order_item_sub_item"
      ADD COLUMN IF NOT EXISTS "expertPositionOfferingId" uuid,
      ADD COLUMN IF NOT EXISTS "unitPrice" decimal(12,2)
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'FK_order_item_sub_item_expertPositionOfferingId'
        ) THEN
          ALTER TABLE "order_item_sub_item"
            ADD CONSTRAINT "FK_order_item_sub_item_expertPositionOfferingId"
            FOREIGN KEY ("expertPositionOfferingId")
            REFERENCES "expert_position_offering"("id") ON DELETE RESTRICT;
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      ALTER TABLE "order_item_sub_item"
      DROP CONSTRAINT IF EXISTS "UQ_order_item_sub_item_orderItemId_serviceId"
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_order_item_sub_item_order_service_not_null"
      ON "order_item_sub_item" ("orderItemId", "serviceId")
      WHERE "serviceId" IS NOT NULL
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_order_item_sub_item_order_offering_not_null"
      ON "order_item_sub_item" ("orderItemId", "expertPositionOfferingId")
      WHERE "expertPositionOfferingId" IS NOT NULL
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'CHK_order_item_sub_item_ref'
        ) THEN
          ALTER TABLE "order_item_sub_item"
            ADD CONSTRAINT "CHK_order_item_sub_item_ref" CHECK (
              ("serviceId" IS NOT NULL) <> ("expertPositionOfferingId" IS NOT NULL)
            );
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      DO $$
      DECLARE
        marketer_id uuid;
        lawyer_id uuid;
        accountant_id uuid;
        it_id uuid;
      BEGIN
        IF (SELECT COUNT(*)::int FROM "expert_position") > 0 THEN
          RETURN;
        END IF;

        INSERT INTO "expert_position" ("name", "description")
        VALUES (
          'Маркетолог',
          'Стратегия продвижения, реклама, аналитика воронки и позиционирование бренда.'
        )
        RETURNING "id" INTO marketer_id;

        INSERT INTO "expert_position" ("name", "description")
        VALUES (
          'Юрист',
          'Договоры, претензионная работа, корпоративные и трудовые вопросы для бизнеса.'
        )
        RETURNING "id" INTO lawyer_id;

        INSERT INTO "expert_position" ("name", "description")
        VALUES (
          'Бухгалтер',
          'Учёт, налоги, отчётность и сопровождение финансовых операций компании.'
        )
        RETURNING "id" INTO accountant_id;

        INSERT INTO "expert_position" ("name", "description")
        VALUES (
          'IT-специалист',
          'Инфраструктура, интеграции, безопасность и техническая поддержка проектов.'
        )
        RETURNING "id" INTO it_id;

        INSERT INTO "expert_position_offering" ("positionId", "name", "description")
        VALUES
          (marketer_id, 'Консультация', 'Разовая консультация маркетолога'),
          (marketer_id, 'Аудит', 'Аудит маркетинговых процессов и каналов'),
          (marketer_id, 'Сопровождение', 'Сопровождение маркетинговых активностей'),
          (lawyer_id, 'Консультация', 'Разовая юридическая консультация'),
          (lawyer_id, 'Аудит', 'Аудит договорной базы и рисков'),
          (lawyer_id, 'Сопровождение', 'Юридическое сопровождение сделок'),
          (accountant_id, 'Консультация', 'Разовая консультация бухгалтера'),
          (accountant_id, 'Аудит', 'Аудит учёта и отчётности'),
          (accountant_id, 'Сопровождение', 'Ведение и сопровождение учёта'),
          (it_id, 'Консультация', 'Разовая IT-консультация'),
          (it_id, 'Аудит', 'Аудит инфраструктуры и процессов'),
          (it_id, 'Сопровождение', 'Техническое сопровождение проекта');

        INSERT INTO "expert_position_member" ("positionId", "userId")
        SELECT pos."id", ranked."userId"
        FROM (
          SELECT
            s."userId",
            (ROW_NUMBER() OVER (ORDER BY s."createdAt", s."id") - 1) % 4 AS pos_index
          FROM "service" s
          INNER JOIN "user" u ON u."id" = s."userId"
          WHERE s."type" = 'Подрядчик'
            AND s."userId" IS NOT NULL
            AND s."deletedAt" IS NULL
            AND u."role" = 'expert'
        ) ranked
        INNER JOIN (
          SELECT "id", ROW_NUMBER() OVER (ORDER BY "createdAt", "name") - 1 AS pos_index
          FROM "expert_position"
        ) pos ON pos.pos_index = ranked.pos_index
        ON CONFLICT ("positionId", "userId") DO NOTHING;

        INSERT INTO "expert_position_member_offering" ("memberId", "offeringId", "price")
        SELECT m."id", o."id",
          CASE p."name"
            WHEN 'Маркетолог' THEN
              CASE o."name"
                WHEN 'Консультация' THEN 15000
                WHEN 'Аудит' THEN 45000
                WHEN 'Сопровождение' THEN 120000
              END
            WHEN 'Юрист' THEN
              CASE o."name"
                WHEN 'Консультация' THEN 20000
                WHEN 'Аудит' THEN 60000
                WHEN 'Сопровождение' THEN 150000
              END
            WHEN 'Бухгалтер' THEN
              CASE o."name"
                WHEN 'Консультация' THEN 12000
                WHEN 'Аудит' THEN 35000
                WHEN 'Сопровождение' THEN 90000
              END
            WHEN 'IT-специалист' THEN
              CASE o."name"
                WHEN 'Консультация' THEN 18000
                WHEN 'Аудит' THEN 50000
                WHEN 'Сопровождение' THEN 130000
              END
          END
        FROM "expert_position_member" m
        INNER JOIN "expert_position" p ON p."id" = m."positionId"
        INNER JOIN "expert_position_offering" o ON o."positionId" = m."positionId"
        ON CONFLICT ("memberId", "offeringId") DO NOTHING;
      END $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "order_item_sub_item" DROP CONSTRAINT IF EXISTS "CHK_order_item_sub_item_ref"
    `);
    await queryRunner.query(`
      DROP INDEX IF EXISTS "UQ_order_item_sub_item_order_offering_not_null"
    `);
    await queryRunner.query(`
      DROP INDEX IF EXISTS "UQ_order_item_sub_item_order_service_not_null"
    `);
    await queryRunner.query(`
      ALTER TABLE "order_item_sub_item" DROP CONSTRAINT IF EXISTS "FK_order_item_sub_item_expertPositionOfferingId"
    `);
    await queryRunner.query(`
      ALTER TABLE "order_item_sub_item"
      DROP COLUMN IF EXISTS "expertPositionOfferingId",
      DROP COLUMN IF EXISTS "unitPrice"
    `);
    await queryRunner.query(`
      DELETE FROM "order_item_sub_item" WHERE "serviceId" IS NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "order_item_sub_item" ALTER COLUMN "serviceId" SET NOT NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "order_item_sub_item"
      ADD CONSTRAINT "UQ_order_item_sub_item_orderItemId_serviceId" UNIQUE ("orderItemId", "serviceId")
    `);

    await queryRunner.query(`
      ALTER TABLE "order_item" DROP CONSTRAINT IF EXISTS "CHK_order_item_product_type"
    `);
    await queryRunner.query(`
      DROP INDEX IF EXISTS "UQ_order_item_order_expert_position_not_null"
    `);
    await queryRunner.query(`
      ALTER TABLE "order_item" DROP CONSTRAINT IF EXISTS "FK_order_item_executorUserId"
    `);
    await queryRunner.query(`
      ALTER TABLE "order_item" DROP CONSTRAINT IF EXISTS "FK_order_item_expertPositionId"
    `);
    await queryRunner.query(`
      ALTER TABLE "order_item"
      DROP COLUMN IF EXISTS "executorUserId",
      DROP COLUMN IF EXISTS "expertPositionId"
    `);
    await queryRunner.query(`
      DELETE FROM "order_item"
      WHERE "serviceId" IS NULL AND "packageId" IS NULL
    `);
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'CHK_order_item_service_xor_package'
        ) THEN
          ALTER TABLE "order_item"
            ADD CONSTRAINT "CHK_order_item_service_xor_package"
            CHECK (("serviceId" IS NOT NULL) <> ("packageId" IS NOT NULL));
        END IF;
      END $$;
    `);

    await queryRunner.query(`DROP TABLE IF EXISTS "expert_position_member_offering"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "expert_position_member"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "expert_position_offering"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "expert_position"`);
  }
}
