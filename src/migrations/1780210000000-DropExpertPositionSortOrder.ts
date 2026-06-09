import { MigrationInterface, QueryRunner } from 'typeorm';

export class DropExpertPositionSortOrder1780210000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "expert_position_offering"
      DROP COLUMN IF EXISTS "sortOrder"
    `);
    await queryRunner.query(`
      ALTER TABLE "expert_position"
      DROP COLUMN IF EXISTS "sortOrder"
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "expert_position"
      ADD COLUMN IF NOT EXISTS "sortOrder" int NOT NULL DEFAULT 0
    `);
    await queryRunner.query(`
      ALTER TABLE "expert_position_offering"
      ADD COLUMN IF NOT EXISTS "sortOrder" int NOT NULL DEFAULT 0
    `);
  }
}
