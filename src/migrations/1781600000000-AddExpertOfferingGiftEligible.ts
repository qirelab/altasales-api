import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddExpertOfferingGiftEligible1781600000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "expert_position_offering"
      ADD COLUMN IF NOT EXISTS "giftEligible" boolean NOT NULL DEFAULT false
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "expert_position_offering"
      DROP COLUMN IF EXISTS "giftEligible"
    `);
  }
}
