import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddHasSeenGiftIntroToUser1780000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "user"
      ADD COLUMN IF NOT EXISTS "hasSeenGiftIntro" boolean NOT NULL DEFAULT false
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "user"
      DROP COLUMN IF EXISTS "hasSeenGiftIntro"
    `);
  }
}
