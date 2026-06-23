import { validate } from 'class-validator';
import { GenerateMyRecommendationsDto } from './generate-my-recommendations.dto';
import { GenerateRecommendationsDto } from './generate-recommendations.dto';

describe('recommendation generation DTO limits', () => {
  it.each([
    Object.assign(new GenerateRecommendationsDto(), {
      userId: '550e8400-e29b-41d4-a716-446655440000',
      limit: 21,
    }),
    Object.assign(new GenerateMyRecommendationsDto(), { limit: 21 }),
  ])('rejects a post-compaction limit above twenty', async (dto) => {
    const errors = await validate(dto);

    expect(errors.some((error) => error.property === 'limit')).toBe(true);
  });

  it.each([
    Object.assign(new GenerateRecommendationsDto(), {
      userId: '550e8400-e29b-41d4-a716-446655440000',
      limit: 20,
    }),
    Object.assign(new GenerateMyRecommendationsDto(), { limit: 20 }),
  ])('accepts a post-compaction limit of twenty', async (dto) => {
    const errors = await validate(dto);

    expect(errors.filter((error) => error.property === 'limit')).toEqual([]);
  });
});
