import { QueryRunner } from 'typeorm';
import { ReclassifyLegacyQuestionnaire1782850000000 } from './1782850000000-ReclassifyLegacyQuestionnaireRecommendations';

describe('ReclassifyLegacyQuestionnaire1782850000000', () => {
  const migration = new ReclassifyLegacyQuestionnaire1782850000000();

  it('reclassifies active questionnaire rows regardless of generatedAt', async () => {
    const query = jest.fn().mockResolvedValue(undefined);
    const queryRunner = { query } as unknown as QueryRunner;

    await migration.up(queryRunner);

    expect(query).toHaveBeenCalledTimes(1);
    const sql = String(query.mock.calls[0][0]);
    expect(sql).toContain('SET "source" = \'ai\'');
    expect(sql).toContain('"source" = \'manual\'');
    expect(sql).toContain('"status" = \'recommended\'');
    expect(sql).toContain('"orderId" IS NULL');
    expect(sql).not.toContain('"generatedAt" IS NULL');
    expect(sql).toContain('рекомендация выбрана по анкете');
  });

  it('does not reverse the provenance repair', async () => {
    const query = jest.fn();

    await migration.down({ query } as unknown as QueryRunner);

    expect(query).not.toHaveBeenCalled();
  });
});
