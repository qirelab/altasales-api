import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPackageGiftEligible1781210000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "service_package"
      ADD COLUMN IF NOT EXISTS "giftEligible" boolean NOT NULL DEFAULT false
    `);

    await queryRunner.query(`
      UPDATE "service_package" AS p
      SET "giftEligible" = true
      WHERE EXISTS (
        SELECT 1
        FROM "package_services" ps
        JOIN "service" s ON s.id = ps."serviceId"
        WHERE ps."packageId" = p.id
          AND s."deletedAt" IS NULL
      )
      AND NOT EXISTS (
        SELECT 1
        FROM "package_services" ps
        JOIN "service" s ON s.id = ps."serviceId"
        WHERE ps."packageId" = p.id
          AND s."deletedAt" IS NULL
          AND s."giftEligible" IS DISTINCT FROM true
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "service_package"
      DROP COLUMN IF EXISTS "giftEligible"
    `);
  }
}
