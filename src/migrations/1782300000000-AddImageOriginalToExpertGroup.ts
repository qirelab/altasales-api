import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddImageOriginalToExpertGroup1782300000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "expert_position"
      ADD COLUMN IF NOT EXISTS "imageOriginal" varchar NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "expert_position" DROP COLUMN IF EXISTS "imageOriginal"
    `);
  }
}
