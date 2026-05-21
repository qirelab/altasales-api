import { MigrationInterface, QueryRunner } from 'typeorm';

export class MakeOrderDeadlineNullable1779405600000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "order"
      ALTER COLUMN "deadline" DROP NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "order"
      SET "deadline" = "createdAt"
      WHERE "deadline" IS NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "order"
      ALTER COLUMN "deadline" SET NOT NULL
    `);
  }
}
