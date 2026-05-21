import { MigrationInterface, QueryRunner } from 'typeorm';

export class AlignOrderSingleItemSchema1779407400000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "payment"
      ADD COLUMN IF NOT EXISTS "orderIds" json
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF to_regclass('"file_entity"') IS NOT NULL THEN
          WITH ranked AS (
            SELECT
              id,
              "orderId",
              ROW_NUMBER() OVER (PARTITION BY "orderId" ORDER BY id) AS rn
            FROM "order_item"
          ),
          keeper AS (
            SELECT id, "orderId"
            FROM ranked
            WHERE rn = 1
          ),
          duplicates AS (
            SELECT id, "orderId"
            FROM ranked
            WHERE rn > 1
          )
          UPDATE "file_entity" f
          SET "orderItemId" = k.id
          FROM duplicates d
          JOIN keeper k ON k."orderId" = d."orderId"
          WHERE f."orderItemId" = d.id;
        ELSIF to_regclass('"file"') IS NOT NULL THEN
          WITH ranked AS (
            SELECT
              id,
              "orderId",
              ROW_NUMBER() OVER (PARTITION BY "orderId" ORDER BY id) AS rn
            FROM "order_item"
          ),
          keeper AS (
            SELECT id, "orderId"
            FROM ranked
            WHERE rn = 1
          ),
          duplicates AS (
            SELECT id, "orderId"
            FROM ranked
            WHERE rn > 1
          )
          UPDATE "file" f
          SET "orderItemId" = k.id
          FROM duplicates d
          JOIN keeper k ON k."orderId" = d."orderId"
          WHERE f."orderItemId" = d.id;
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      WITH aggregated AS (
        SELECT
          "orderId",
          SUM(amount)::numeric(12,2) AS total_amount,
          SUM(COALESCE(hours, 0))::numeric(10,2) AS total_hours,
          BOOL_OR(hours IS NOT NULL) AS has_hours
        FROM "order_item"
        GROUP BY "orderId"
      ),
      keeper AS (
        SELECT MIN(id) AS id, "orderId"
        FROM "order_item"
        GROUP BY "orderId"
      )
      UPDATE "order_item" oi
      SET
        amount = a.total_amount,
        hours = CASE WHEN a.has_hours THEN a.total_hours ELSE NULL END
      FROM aggregated a
      JOIN keeper k ON k."orderId" = a."orderId"
      WHERE oi.id = k.id
    `);

    await queryRunner.query(`
      WITH ranked AS (
        SELECT
          id,
          ROW_NUMBER() OVER (PARTITION BY "orderId" ORDER BY id) AS rn
        FROM "order_item"
      )
      DELETE FROM "order_item" oi
      USING ranked r
      WHERE oi.id = r.id
        AND r.rn > 1
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_order_item_orderId"
      ON "order_item" ("orderId")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "UQ_order_item_orderId"
    `);

    await queryRunner.query(`
      ALTER TABLE "payment"
      DROP COLUMN IF EXISTS "orderIds"
    `);
  }
}
