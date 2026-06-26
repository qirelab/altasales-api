import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddImageOriginalToCatalog1782200000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "service"
      ADD COLUMN IF NOT EXISTS "imageOriginal" varchar NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "service_package"
      ADD COLUMN IF NOT EXISTS "imageOriginal" varchar NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "expert_profile"
      ADD COLUMN IF NOT EXISTS "imageOriginal" varchar NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "expert_profile" DROP COLUMN IF EXISTS "imageOriginal"
    `);
    await queryRunner.query(`
      ALTER TABLE "service_package" DROP COLUMN IF EXISTS "imageOriginal"
    `);
    await queryRunner.query(`
      ALTER TABLE "service" DROP COLUMN IF EXISTS "imageOriginal"
    `);
  }
}
