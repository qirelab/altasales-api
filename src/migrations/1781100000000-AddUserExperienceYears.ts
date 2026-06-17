import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUserExperienceYears1781100000000 implements MigrationInterface {
  name = 'AddUserExperienceYears1781100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "user"
      ADD COLUMN IF NOT EXISTS "experienceYears" integer NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "user"
      DROP COLUMN IF EXISTS "experienceYears"
    `);
  }
}
