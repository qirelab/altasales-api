import { MigrationInterface, QueryRunner } from 'typeorm';

export class RelaxExecutorUserFkOnDelete1782127000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "order_item"
      DROP CONSTRAINT IF EXISTS "FK_order_item_executorUserId"
    `);
    await queryRunner.query(`
      ALTER TABLE "order_item"
      ADD CONSTRAINT "FK_order_item_executorUserId"
      FOREIGN KEY ("executorUserId") REFERENCES "user"("id") ON DELETE SET NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "cart_item"
      DROP CONSTRAINT IF EXISTS "FK_cart_item_executor_user"
    `);
    await queryRunner.query(`
      ALTER TABLE "cart_item"
      ADD CONSTRAINT "FK_cart_item_executor_user"
      FOREIGN KEY ("executorUserId") REFERENCES "user"("id") ON DELETE SET NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "order_item"
      DROP CONSTRAINT IF EXISTS "FK_order_item_executorUserId"
    `);
    await queryRunner.query(`
      ALTER TABLE "order_item"
      ADD CONSTRAINT "FK_order_item_executorUserId"
      FOREIGN KEY ("executorUserId") REFERENCES "user"("id") ON DELETE RESTRICT
    `);

    await queryRunner.query(`
      ALTER TABLE "cart_item"
      DROP CONSTRAINT IF EXISTS "FK_cart_item_executor_user"
    `);
    await queryRunner.query(`
      ALTER TABLE "cart_item"
      ADD CONSTRAINT "FK_cart_item_executor_user"
      FOREIGN KEY ("executorUserId") REFERENCES "user"("id") ON DELETE RESTRICT
    `);
  }
}
