import { QueryRunner } from 'typeorm';
// eslint-disable-next-line max-len
import { BackfillLegacyQuestionnaireRecommendationSources1782840000000 } from './1782840000000-BackfillLegacyQuestionnaireRecommendationSources';

describe('BackfillLegacyQuestionnaireRecommendationSources1782840000000', () => {
  const migration =
    new BackfillLegacyQuestionnaireRecommendationSources1782840000000();

  it('reclassifies only active legacy questionnaire recommendations', async () => {
    const query = jest.fn().mockResolvedValue(undefined);
    const queryRunner = { query } as unknown as QueryRunner;

    await migration.up(queryRunner);

    expect(query).toHaveBeenCalledTimes(1);
    const sql = String(query.mock.calls[0][0]);

    expect(sql).toContain('SET "source" = \'ai\'');
    expect(sql).toContain('"source" = \'manual\'');
    expect(sql).toContain('"status" = \'recommended\'');
    expect(sql).toContain('"orderId" IS NULL');
    expect(sql).toContain('"generatedAt" IS NULL');
    expect(sql).toMatch(
      /encode\(convert_to\(lower\("rationale"\), 'UTF8'\), 'hex'\) LIKE ANY/,
    );
    expect(sql.match(/d180d0b5d0bad0bed0bcd0b5d0bdd0b4/g)).toHaveLength(2);
  });

  it('does not reverse the provenance repair on rollback', async () => {
    const query = jest.fn();
    const queryRunner = { query } as unknown as QueryRunner;

    await migration.down(queryRunner);

    expect(query).not.toHaveBeenCalled();
  });
});
