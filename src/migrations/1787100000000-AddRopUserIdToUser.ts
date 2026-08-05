import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddRopUserIdToUser1787100000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "user"
      ADD COLUMN IF NOT EXISTS "ropUserId" varchar NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "user" DROP COLUMN IF EXISTS "ropUserId"
    `);
  }
}
