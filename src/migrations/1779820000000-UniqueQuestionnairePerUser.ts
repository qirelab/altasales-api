import { MigrationInterface, QueryRunner } from 'typeorm';

export class UniqueQuestionnairePerUser1779820000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM "questionnaires" old
      WHERE old.id IN (
        SELECT ranked.id
        FROM (
          SELECT
            id,
            ROW_NUMBER() OVER (
              PARTITION BY "userId"
              ORDER BY "createdAt" DESC, id DESC
            ) AS rn
          FROM "questionnaires"
        ) ranked
        WHERE ranked.rn > 1
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_questionnaires_userId"
      ON "questionnaires" ("userId")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "UQ_questionnaires_userId"
    `);
  }
}
