import {
  selectNonOverlappingRecommendations,
} from './recommendation-coverage.util';

describe('recommendation coverage selection', () => {
  it('keeps CRM Start instead of its covered phone and messenger services', () => {
    const result = selectNonOverlappingRecommendations([
      {
        serviceId: '3dd98b30-1d7c-4c99-b8bd-0bb8cfcbcaca',
        packageId: null,
        coveredServiceIds: ['3dd98b30-1d7c-4c99-b8bd-0bb8cfcbcaca'],
        score: 85,
      },
      {
        serviceId: 'da4c0e35-54a8-41f4-88a7-78e43c0ae5be',
        packageId: null,
        coveredServiceIds: ['da4c0e35-54a8-41f4-88a7-78e43c0ae5be'],
        score: 84,
      },
      {
        serviceId: null,
        packageId: '292a8ec3-ea07-4326-9bb8-fed6056b3b20',
        coveredServiceIds: [
          '3dd98b30-1d7c-4c99-b8bd-0bb8cfcbcaca',
          'da4c0e35-54a8-41f4-88a7-78e43c0ae5be',
          '59f1273e-fff8-49da-9553-776579985660',
        ],
        score: 95,
      },
    ]);

    expect(result.map((item) => item.packageId ?? item.serviceId)).toEqual([
      '292a8ec3-ea07-4326-9bb8-fed6056b3b20',
    ]);
  });

  it('applies the same coverage rule to an arbitrary future package', () => {
    const result = selectNonOverlappingRecommendations([
      {
        serviceId: 'service-a',
        packageId: null,
        coveredServiceIds: ['service-a'],
        score: 90,
      },
      {
        serviceId: 'service-b',
        packageId: null,
        coveredServiceIds: ['service-b'],
        score: 89,
      },
      {
        serviceId: null,
        packageId: 'future-package',
        coveredServiceIds: ['service-a', 'service-b'],
        score: 80,
      },
    ]);

    expect(result.map((item) => item.packageId ?? item.serviceId)).toEqual([
      'future-package',
    ]);
  });
});
