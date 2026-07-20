import { MigrationInterface, QueryRunner } from 'typeorm';

export class BackfillLegacyQuestionnaireRecommendationSources1782840000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "recommendation"
      SET "source" = 'ai',
          "generatedAt" = COALESCE("updatedAt", "createdAt", NOW())
      WHERE "source" = 'manual'
        AND "status" = 'recommended'
        AND "orderId" IS NULL
        AND "generatedAt" IS NULL
        AND encode(convert_to(lower("rationale"), 'UTF8'), 'hex') LIKE ANY (
          ARRAY[
            '%' ||
              'd180d0b5d0bad0bed0bcd0b5d0bdd0b4d0b0d186d0b8d18f20d0b2d18bd0b1d180' ||
              'd0b0d0bdd0b020d0bfd0be20d0b0d0bdd0bad0b5d182d0b5' ||
              '%',
            '%' ||
              'd180d0b5d0bad0bed0bcd0b5d0bdd0b4d0b0d186d0b8d18f20d181d0bed0bed182' ||
              'd0b2d0b5d182d181d182d0b2d183d0b5d18220d18fd0b2d0bdd0be20d183d0bad0b0' ||
              'd0b7d0b0d0bdd0bdd18bd0bc20d0bed182d0b2d0b5d182d0b0d0bc20d0b0d0bdd0ba' ||
              'd0b5d182d18b' ||
              '%'
          ]
        )
    `);
  }

  public async down(): Promise<void> {
    // Provenance repair is intentionally irreversible.
  }
}
