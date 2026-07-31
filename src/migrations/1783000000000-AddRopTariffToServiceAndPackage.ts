import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddRopTariffToServiceAndPackage1783000000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "service"
      ADD COLUMN IF NOT EXISTS "ropTariff" varchar(20) NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "service_package"
      ADD COLUMN IF NOT EXISTS "ropTariff" varchar(20) NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "service" DROP COLUMN IF EXISTS "ropTariff"
    `);

    await queryRunner.query(`
      ALTER TABLE "service_package" DROP COLUMN IF EXISTS "ropTariff"
    `);
  }
}
