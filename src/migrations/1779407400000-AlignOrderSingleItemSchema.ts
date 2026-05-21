import { MigrationInterface, QueryRunner } from 'typeorm';

export class AlignOrderSingleItemSchema1779407400000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "payment"
      ADD COLUMN IF NOT EXISTS "orderIds" json
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
