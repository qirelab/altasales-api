import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPackageItemsToCartAndOrders1779412800000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "cart_item"
      ADD COLUMN IF NOT EXISTS "packageId" uuid
    `);
    await queryRunner.query(`
      ALTER TABLE "order_item"
      ADD COLUMN IF NOT EXISTS "packageId" uuid
    `);

    await queryRunner.query(`
      ALTER TABLE "cart_item"
      ALTER COLUMN "serviceId" DROP NOT NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "order_item"
      ALTER COLUMN "serviceId" DROP NOT NULL
    `);

    await queryRunner.query(`
      DO $$
      DECLARE con_name text;
      BEGIN
        SELECT tc.constraint_name
        INTO con_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON tc.constraint_name = kcu.constraint_name
         AND tc.table_schema = kcu.table_schema
        WHERE tc.table_schema = 'public'
          AND tc.table_name = 'cart_item'
          AND tc.constraint_type = 'UNIQUE'
        GROUP BY tc.constraint_name
        HAVING array_agg(kcu.column_name ORDER BY kcu.ordinal_position) = ARRAY['cartId', 'serviceId'];

        IF con_name IS NOT NULL THEN
          EXECUTE format('ALTER TABLE "cart_item" DROP CONSTRAINT %I', con_name);
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conname = 'FK_cart_item_packageId_service_package'
        ) THEN
          ALTER TABLE "cart_item"
            ADD CONSTRAINT "FK_cart_item_packageId_service_package"
            FOREIGN KEY ("packageId")
            REFERENCES "service_package"("id")
            ON DELETE CASCADE;
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conname = 'FK_order_item_packageId_service_package'
        ) THEN
          ALTER TABLE "order_item"
            ADD CONSTRAINT "FK_order_item_packageId_service_package"
            FOREIGN KEY ("packageId")
            REFERENCES "service_package"("id")
            ON DELETE RESTRICT;
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_cart_item_cart_service_not_null"
      ON "cart_item" ("cartId", "serviceId")
      WHERE "serviceId" IS NOT NULL
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_cart_item_cart_package_not_null"
      ON "cart_item" ("cartId", "packageId")
      WHERE "packageId" IS NOT NULL
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_order_item_order_service_not_null"
      ON "order_item" ("orderId", "serviceId")
      WHERE "serviceId" IS NOT NULL
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_order_item_order_package_not_null"
      ON "order_item" ("orderId", "packageId")
      WHERE "packageId" IS NOT NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "cart_item"
      DROP CONSTRAINT IF EXISTS "CHK_cart_item_service_xor_package"
    `);
    await queryRunner.query(`
      ALTER TABLE "cart_item"
      ADD CONSTRAINT "CHK_cart_item_service_xor_package"
      CHECK (("serviceId" IS NOT NULL) <> ("packageId" IS NOT NULL))
    `);

    await queryRunner.query(`
      ALTER TABLE "order_item"
      DROP CONSTRAINT IF EXISTS "CHK_order_item_service_xor_package"
    `);
    await queryRunner.query(`
      ALTER TABLE "order_item"
      ADD CONSTRAINT "CHK_order_item_service_xor_package"
      CHECK (("serviceId" IS NOT NULL) <> ("packageId" IS NOT NULL))
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "order_item"
      DROP CONSTRAINT IF EXISTS "CHK_order_item_service_xor_package"
    `);
    await queryRunner.query(`
      ALTER TABLE "cart_item"
      DROP CONSTRAINT IF EXISTS "CHK_cart_item_service_xor_package"
    `);

    await queryRunner.query(`
      DROP INDEX IF EXISTS "UQ_order_item_order_package_not_null"
    `);
    await queryRunner.query(`
      DROP INDEX IF EXISTS "UQ_order_item_order_service_not_null"
    `);
    await queryRunner.query(`
      DROP INDEX IF EXISTS "UQ_cart_item_cart_package_not_null"
    `);
    await queryRunner.query(`
      DROP INDEX IF EXISTS "UQ_cart_item_cart_service_not_null"
    `);

    await queryRunner.query(`
      ALTER TABLE "order_item"
      DROP CONSTRAINT IF EXISTS "FK_order_item_packageId_service_package"
    `);
    await queryRunner.query(`
      ALTER TABLE "cart_item"
      DROP CONSTRAINT IF EXISTS "FK_cart_item_packageId_service_package"
    `);

    await queryRunner.query(`
      UPDATE "order_item"
      SET "serviceId" = (
        SELECT ps."serviceId"
        FROM "package_services" ps
        WHERE ps."packageId" = "order_item"."packageId"
        LIMIT 1
      )
      WHERE "serviceId" IS NULL
    `);
    await queryRunner.query(`
      UPDATE "cart_item"
      SET "serviceId" = (
        SELECT ps."serviceId"
        FROM "package_services" ps
        WHERE ps."packageId" = "cart_item"."packageId"
        LIMIT 1
      )
      WHERE "serviceId" IS NULL
    `);

    await queryRunner.query(`
      DELETE FROM "order_item" WHERE "serviceId" IS NULL
    `);
    await queryRunner.query(`
      DELETE FROM "cart_item" WHERE "serviceId" IS NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "order_item"
      ALTER COLUMN "serviceId" SET NOT NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "cart_item"
      ALTER COLUMN "serviceId" SET NOT NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "order_item"
      DROP COLUMN IF EXISTS "packageId"
    `);
    await queryRunner.query(`
      ALTER TABLE "cart_item"
      DROP COLUMN IF EXISTS "packageId"
    `);
  }
}
