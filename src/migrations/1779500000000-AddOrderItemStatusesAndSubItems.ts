import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOrderItemStatusesAndSubItems1779500000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "order_item"
      ADD COLUMN IF NOT EXISTS "status" "order_status_enum"
    `);

    await queryRunner.query(`
      UPDATE "order_item" oi
      SET "status" = o."status"
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
        "status" "order_status_enum" NOT NULL DEFAULT 'planned',
        CONSTRAINT "PK_order_item_sub_item_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_order_item_sub_item_orderItemId_serviceId" UNIQUE ("orderItemId", "serviceId"),
        CONSTRAINT "FK_order_item_sub_item_orderItemId" FOREIGN KEY ("orderItemId") REFERENCES "order_item"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_order_item_sub_item_serviceId" FOREIGN KEY ("serviceId") REFERENCES "service"("id") ON DELETE RESTRICT
      )
    `);

    await queryRunner.query(`
      INSERT INTO "order_item_sub_item" ("orderItemId", "serviceId", "status")
      SELECT oi."id", ps."serviceId", oi."status"
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
  }
}
