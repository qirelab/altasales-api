import { Logger } from '@nestjs/common';
import { ServiceType } from '../services/entities/service-type.enum';
import { RecommendationPriority } from './entities/recommendation-priority.enum';
import { RecommendationScoringService } from './recommendation-scoring.service';

describe('RecommendationScoringService', () => {
  const llmProxy = {
    chat: jest.fn(),
  };

  let service: RecommendationScoringService;

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    llmProxy.chat.mockReset();
    service = new RecommendationScoringService(llmProxy as any);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('resolves priority by score and urgent signals', () => {
    expect(service.resolvePriority(0, [])).toBe(RecommendationPriority.Low);
    expect(service.resolvePriority(3, [])).toBe(RecommendationPriority.Medium);
    expect(
      service.resolvePriority(1, [{ priority: RecommendationPriority.Urgent }]),
    ).toBe(RecommendationPriority.Urgent);
  });

  it('matches exact short terms without substring false positives', () => {
    const candidate = {
      id: 'service-id',
      name: 'Revenue audit',
      description: 'Revenue and profit analytics',
      type: ServiceType.Service,
      skills: [],
      category: null,
    } as any;

    const falsePositive = service.scoreService(
      candidate,
      service.normalizeText('planetary discussion'),
    );
    const exactMatch = service.scoreService(
      candidate,
      service.normalizeText('revenue plan is at risk'),
    );

    expect(falsePositive.score).toBe(0);
    expect(exactMatch.score).toBeGreaterThan(0);
  });

  it('builds normalized diagnostic context', () => {
    expect(
      service.buildDiagnosticContext({
        userId: 'user-id',
        clientProfile: { channel: 'CRM' },
        diagnostics: ['Revenue   PLAN'],
      }),
    ).toContain('revenue plan');
  });

  it('logs and falls back when AI returns invalid JSON', async () => {
    llmProxy.chat.mockResolvedValueOnce({ content: 'not json' });

    await expect(
      service.generateAiRecommendations(
        {
          userId: 'user-id',
          diagnostics: ['revenue plan'],
        },
        [],
        'revenue plan',
      ),
    ).resolves.toEqual([]);
    expect(Logger.prototype.warn).toHaveBeenCalled();
  });
});
