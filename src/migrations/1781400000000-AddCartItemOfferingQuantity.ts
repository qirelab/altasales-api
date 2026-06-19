import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCartItemOfferingQuantity1781400000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "cart_item_offering"
      ADD COLUMN IF NOT EXISTS "quantity" int NOT NULL DEFAULT 1
    `);

    await queryRunner.query(`
      UPDATE "cart_item_offering" offering
      SET "quantity" = GREATEST(item."quantity", 1)
      FROM "cart_item" item
      WHERE item.id = offering."cartItemId"
        AND item."expertPositionId" IS NOT NULL
    `);

    await queryRunner.query(`
      UPDATE "cart_item"
      SET "quantity" = 1
      WHERE "expertPositionId" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "cart_item" item
      SET "quantity" = sub.max_quantity
      FROM (
        SELECT "cartItemId", MAX("quantity") AS max_quantity
        FROM "cart_item_offering"
        GROUP BY "cartItemId"
      ) sub
      WHERE item.id = sub."cartItemId"
        AND item."expertPositionId" IS NOT NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "cart_item_offering"
      DROP COLUMN IF EXISTS "quantity"
    `);
  }
}
