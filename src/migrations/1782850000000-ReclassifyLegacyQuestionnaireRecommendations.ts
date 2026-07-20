import { MigrationInterface, QueryRunner } from 'typeorm';

export class ReclassifyLegacyQuestionnaire1782850000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "recommendation"
      SET "source" = 'ai',
          "generatedAt" = COALESCE("generatedAt", "updatedAt", "createdAt", NOW())
      WHERE "source" = 'manual'
        AND "status" = 'recommended'
        AND "orderId" IS NULL
        AND (
          "rationale" ILIKE '%рекомендация выбрана по анкете%'
          OR "rationale" ILIKE '%рекомендация соответствует явно указанным ответам анкеты%'
        )
    `);
  }

  public async down(): Promise<void> {
    // Provenance repair is intentionally irreversible.
  }
}
