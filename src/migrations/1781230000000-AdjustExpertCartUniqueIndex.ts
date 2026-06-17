import { MigrationInterface, QueryRunner } from 'typeorm';

export class AdjustExpertCartUniqueIndex1781230000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "UQ_cart_item_cart_expert_position_not_null"
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_cart_item_cart_expert_position_executor_not_null"
      ON "cart_item" ("cartId", "expertPositionId", "executorUserId")
      WHERE "expertPositionId" IS NOT NULL AND "executorUserId" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "UQ_cart_item_cart_expert_position_executor_not_null"
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_cart_item_cart_expert_position_not_null"
      ON "cart_item" ("cartId", "expertPositionId")
      WHERE "expertPositionId" IS NOT NULL
    `);
  }
}
