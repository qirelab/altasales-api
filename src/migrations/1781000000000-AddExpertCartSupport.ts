import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddExpertCartSupport1781000000000 implements MigrationInterface {
  name = 'AddExpertCartSupport1781000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "cart_item"
      ADD COLUMN IF NOT EXISTS "expertPositionId" uuid NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "cart_item"
      ADD COLUMN IF NOT EXISTS "executorUserId" uuid NULL
    `);

    await queryRunner.query(`
      UPDATE "cart_item"
      SET "expertPositionId" = NULL
      WHERE "expertPositionId" IS NOT NULL
        AND "expertPositionId" NOT IN (SELECT "id" FROM "expert_position")
    `);

    await queryRunner.query(`
      UPDATE "cart_item"
      SET "executorUserId" = NULL
      WHERE "executorUserId" IS NOT NULL
        AND "executorUserId" NOT IN (SELECT "id" FROM "user")
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'FK_cart_item_expert_position'
        ) THEN
          ALTER TABLE "cart_item"
          ADD CONSTRAINT "FK_cart_item_expert_position"
          FOREIGN KEY ("expertPositionId") REFERENCES "expert_position"("id") ON DELETE CASCADE;
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'FK_cart_item_executor_user'
        ) THEN
          ALTER TABLE "cart_item"
          ADD CONSTRAINT "FK_cart_item_executor_user"
          FOREIGN KEY ("executorUserId") REFERENCES "user"("id") ON DELETE RESTRICT;
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      ALTER TABLE "cart_item"
      DROP CONSTRAINT IF EXISTS "CHK_cart_item_service_xor_package"
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'CHK_cart_item_product_type'
        ) THEN
          ALTER TABLE "cart_item"
          ADD CONSTRAINT "CHK_cart_item_product_type"
          CHECK (
            ((("serviceId" IS NOT NULL)::int)
              + (("packageId" IS NOT NULL)::int)
              + (("expertPositionId" IS NOT NULL)::int)) = 1
          );
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_cart_item_cart_expert_position_not_null"
      ON "cart_item" ("cartId", "expertPositionId")
      WHERE "expertPositionId" IS NOT NULL
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "cart_item_offering" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "cartItemId" uuid NOT NULL,
        "expertPositionOfferingId" uuid NOT NULL,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'FK_cart_item_offering_cart_item'
        ) THEN
          ALTER TABLE "cart_item_offering"
          ADD CONSTRAINT "FK_cart_item_offering_cart_item"
          FOREIGN KEY ("cartItemId") REFERENCES "cart_item"("id") ON DELETE CASCADE;
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'FK_cart_item_offering_position_offering'
        ) THEN
          ALTER TABLE "cart_item_offering"
          ADD CONSTRAINT "FK_cart_item_offering_position_offering"
          FOREIGN KEY ("expertPositionOfferingId") REFERENCES "expert_position_offering"("id")
            ON DELETE RESTRICT;
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_cart_item_offering_item_offering"
      ON "cart_item_offering" ("cartItemId", "expertPositionOfferingId")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_cart_item_offering_item_offering"`);
    await queryRunner.query(`
      ALTER TABLE "cart_item_offering"
      DROP CONSTRAINT IF EXISTS "FK_cart_item_offering_position_offering"
    `);
    await queryRunner.query(`
      ALTER TABLE "cart_item_offering"
      DROP CONSTRAINT IF EXISTS "FK_cart_item_offering_cart_item"
    `);
    await queryRunner.query(`DROP TABLE IF EXISTS "cart_item_offering"`);

    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_cart_item_cart_expert_position_not_null"`);
    await queryRunner.query(`
      ALTER TABLE "cart_item"
      DROP CONSTRAINT IF EXISTS "CHK_cart_item_product_type"
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'CHK_cart_item_service_xor_package'
        ) THEN
          ALTER TABLE "cart_item"
          ADD CONSTRAINT "CHK_cart_item_service_xor_package"
          CHECK (("serviceId" IS NOT NULL) <> ("packageId" IS NOT NULL));
        END IF;
      END $$;
    `);
    await queryRunner.query(`
      ALTER TABLE "cart_item"
      DROP CONSTRAINT IF EXISTS "FK_cart_item_executor_user"
    `);
    await queryRunner.query(`
      ALTER TABLE "cart_item"
      DROP CONSTRAINT IF EXISTS "FK_cart_item_expert_position"
    `);
    await queryRunner.query(`ALTER TABLE "cart_item" DROP COLUMN IF EXISTS "executorUserId"`);
    await queryRunner.query(`ALTER TABLE "cart_item" DROP COLUMN IF EXISTS "expertPositionId"`);
  }
}
