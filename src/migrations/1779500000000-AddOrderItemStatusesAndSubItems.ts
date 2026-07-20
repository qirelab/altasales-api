import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOrderItemStatusesAndSubItems1779500000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'order_item_status_enum') THEN
          CREATE TYPE "order_item_status_enum" AS ENUM (
            'pending_payment',
            'planned',
            'in_progress',
            'cancelled',
            'completed'
          );
        END IF;

        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'order_item_sub_item_status_enum') THEN
          CREATE TYPE "order_item_sub_item_status_enum" AS ENUM (
            'pending_payment',
            'planned',
            'in_progress',
            'cancelled',
            'completed'
          );
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      ALTER TABLE "order_item"
      ADD COLUMN IF NOT EXISTS "status" "order_item_status_enum"
    `);

    await queryRunner.query(`
      ALTER TABLE "order_item"
      ALTER COLUMN "status" TYPE "order_item_status_enum"
      USING (
        CASE
          WHEN "status"::text IN ('pending_payment', 'planned', 'in_progress', 'cancelled', 'completed')
            THEN "status"::text::"order_item_status_enum"
          ELSE 'planned'::"order_item_status_enum"
        END
      )
    `);

    await queryRunner.query(`
      UPDATE "order_item" oi
      SET "status" = (
        CASE
          WHEN o."status" IN ('pending_payment', 'planned', 'in_progress', 'cancelled', 'completed')
            THEN o."status"::"order_item_status_enum"
          ELSE 'planned'::"order_item_status_enum"
        END
      )
      FROM "order" o
      WHERE oi."orderId" = o."id"
        AND oi."status" IS NULL
    `);

    await queryRunner.query(`
      UPDATE "order_item"
      SET "status" = 'planned'
      WHERE "status" IS NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "order_item"
      ALTER COLUMN "status" SET DEFAULT 'planned',
      ALTER COLUMN "status" SET NOT NULL
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "order_item_sub_item" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "orderItemId" uuid NOT NULL,
        "serviceId" uuid NOT NULL,
        "status" "order_item_sub_item_status_enum" NOT NULL DEFAULT 'planned',
        CONSTRAINT "PK_order_item_sub_item_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_order_item_sub_item_orderItemId_serviceId" UNIQUE ("orderItemId", "serviceId"),
        CONSTRAINT "FK_order_item_sub_item_orderItemId"
          FOREIGN KEY ("orderItemId") REFERENCES "order_item"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_order_item_sub_item_serviceId" FOREIGN KEY ("serviceId") REFERENCES "service"("id") ON DELETE RESTRICT
      )
    `);

    await queryRunner.query(`
      INSERT INTO "order_item_sub_item" ("orderItemId", "serviceId", "status")
      SELECT oi."id", ps."serviceId", oi."status"::text::"order_item_sub_item_status_enum"
      FROM "order_item" oi
      INNER JOIN "package_services" ps ON ps."packageId" = oi."packageId"
      WHERE oi."packageId" IS NOT NULL
      ON CONFLICT ("orderItemId", "serviceId") DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP TABLE IF EXISTS "order_item_sub_item"
    `);

    await queryRunner.query(`
      ALTER TABLE "order_item"
      DROP COLUMN IF EXISTS "status"
    `);

    await queryRunner.query(`
      DROP TYPE IF EXISTS "order_item_sub_item_status_enum"
    `);

    await queryRunner.query(`
      DROP TYPE IF EXISTS "order_item_status_enum"
    `);
  }
}
