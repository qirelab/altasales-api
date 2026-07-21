import { QueryRunner } from 'typeorm';
import * as migrationModule from './1782860000000-ReclassifyAllLegacyQuestionnaireRecommendations';

describe('ReclassifyAllLegacyQuestionnaireRecommendations1782860000000', () => {
  const migration =
    new migrationModule.ReclassifyAllLegacyQuestionnaireRecommendations1782860000000();

  it('reclassifies the confirmed legacy questionnaire snapshot', async () => {
    const query = jest.fn().mockResolvedValue(undefined);
    const queryRunner = { query } as unknown as QueryRunner;

    await migration.up(queryRunner);

    expect(query).toHaveBeenCalledTimes(1);
    const sql = String(query.mock.calls[0][0]);
    expect(sql).toContain('SET "source" = \'ai\'');
    expect(sql).toContain('"source" = \'manual\'');
    expect(sql).toContain('"status" = \'recommended\'');
    expect(sql).toContain('"orderId" IS NULL');
    expect(sql).toContain('TIMESTAMPTZ');
    expect(sql).toContain('2026-06-23 00:00:00+02');
    expect(sql).toContain('FROM "questionnaires"');
    expect(sql).toContain(
      '"questionnaire"."userId" = "recommendation"."userId"',
    );
    expect(sql).not.toContain('ILIKE');
  });

  it('does not reverse the provenance repair', async () => {
    const query = jest.fn();

    await migration.down({ query } as unknown as QueryRunner);

    expect(query).not.toHaveBeenCalled();
  });
});
