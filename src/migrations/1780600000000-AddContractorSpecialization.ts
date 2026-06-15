import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddContractorSpecialization1780600000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "service"
      ADD COLUMN IF NOT EXISTS "contractorSpecialization" varchar NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "service"
      DROP COLUMN IF EXISTS "contractorSpecialization"
    `);
  }
}
