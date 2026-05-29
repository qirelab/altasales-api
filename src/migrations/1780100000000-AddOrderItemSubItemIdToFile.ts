import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOrderItemSubItemIdToFile1780100000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "file_entity"
      ADD COLUMN IF NOT EXISTS "orderItemSubItemId" uuid NULL
    `);
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'FK_file_entity_order_item_sub_item'
        ) THEN
          ALTER TABLE "file_entity"
            ADD CONSTRAINT "FK_file_entity_order_item_sub_item"
            FOREIGN KEY ("orderItemSubItemId") REFERENCES "order_item_sub_item"("id")
            ON DELETE CASCADE;
        END IF;
      END $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "file_entity"
      DROP CONSTRAINT IF EXISTS "FK_file_entity_order_item_sub_item"
    `);
    await queryRunner.query(`
      ALTER TABLE "file_entity"
      DROP COLUMN IF EXISTS "orderItemSubItemId"
    `);
  }
}
