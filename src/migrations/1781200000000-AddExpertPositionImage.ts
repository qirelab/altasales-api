import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddExpertPositionImage1781200000000 implements MigrationInterface {
  name = 'AddExpertPositionImage1781200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "expert_position"
      ADD COLUMN IF NOT EXISTS "image" varchar(1024)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "expert_position"
      DROP COLUMN IF EXISTS "image"
    `);
  }
}
