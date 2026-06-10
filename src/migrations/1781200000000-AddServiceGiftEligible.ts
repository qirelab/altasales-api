import { MigrationInterface, QueryRunner } from 'typeorm';
import { ServiceType } from '../services/entities/service-type.enum';

export class AddServiceGiftEligible1781200000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "service"
      ADD COLUMN IF NOT EXISTS "giftEligible" boolean NOT NULL DEFAULT false
    `);

    await queryRunner.query(
      `
        UPDATE "service"
        SET "giftEligible" = true
        WHERE "type" = $1
          AND "giftEligible" IS DISTINCT FROM true
      `,
      [ServiceType.Document],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "service"
      DROP COLUMN IF EXISTS "giftEligible"
    `);
  }
}
