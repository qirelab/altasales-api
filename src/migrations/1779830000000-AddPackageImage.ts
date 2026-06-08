import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPackageImage1779830000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "service_package"
      ADD COLUMN IF NOT EXISTS "image" varchar NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "service_package"
      DROP COLUMN IF EXISTS "image"
    `);
  }
}
