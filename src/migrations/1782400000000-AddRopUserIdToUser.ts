import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddRopUserIdToUser1782400000000 implements MigrationInterface {
  name = 'AddRopUserIdToUser1782400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "user"
      ADD COLUMN IF NOT EXISTS "ropUserId" varchar NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "user"
      DROP COLUMN IF EXISTS "ropUserId"
    `);
  }
}
