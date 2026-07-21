import { MigrationInterface, QueryRunner } from 'typeorm';

export class ReclassifyAllLegacyQuestionnaireRecommendations1782860000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "recommendation" AS "recommendation"
      SET "source" = 'ai',
          "generatedAt" = COALESCE(
            "recommendation"."generatedAt",
            "recommendation"."updatedAt",
            "recommendation"."createdAt",
            NOW()
          )
      WHERE "recommendation"."source" = 'manual'
        AND "recommendation"."status" = 'recommended'
        AND "recommendation"."orderId" IS NULL
        AND "recommendation"."createdAt" < TIMESTAMPTZ '2026-06-23 00:00:00+02'
        AND EXISTS (
          SELECT 1
          FROM "questionnaires" AS "questionnaire"
          WHERE "questionnaire"."userId" = "recommendation"."userId"
            AND "questionnaire"."createdAt" <= "recommendation"."createdAt"
        )
    `);
  }

  public async down(): Promise<void> {
    // Provenance repair is intentionally irreversible.
  }
}
