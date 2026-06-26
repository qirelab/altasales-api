import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddImageCropToCatalogEntities1782129000000 implements MigrationInterface {
  name = 'AddImageCropToCatalogEntities1782129000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "service"
      ADD COLUMN IF NOT EXISTS "imageCrop" json NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "service_package"
      ADD COLUMN IF NOT EXISTS "imageCrop" json NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "expert_position"
      ADD COLUMN IF NOT EXISTS "imageCrop" json NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "expert_profile"
      ADD COLUMN IF NOT EXISTS "imageCrop" json NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "expert_profile" DROP COLUMN IF EXISTS "imageCrop"
    `);
    await queryRunner.query(`
      ALTER TABLE "expert_position" DROP COLUMN IF EXISTS "imageCrop"
    `);
    await queryRunner.query(`
      ALTER TABLE "service_package" DROP COLUMN IF EXISTS "imageCrop"
    `);
    await queryRunner.query(`
      ALTER TABLE "service" DROP COLUMN IF EXISTS "imageCrop"
    `);
  }
}
