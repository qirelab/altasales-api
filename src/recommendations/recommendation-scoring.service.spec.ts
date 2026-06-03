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

  it('scores package targets using package tags and included services', () => {
    const servicePackage = {
      id: 'package-id',
      name: 'CRM Silver',
      description: 'Advanced CRM launch package',
      price: 100000,
      tags: ['CRM', 'analytics'],
      packageType: 'Silver',
      category: { name: 'Packages' },
      services: [
        {
          id: 'dashboard-service-id',
          name: 'Dashboard',
          description: 'CRM analytics and reporting',
          type: ServiceType.Service,
          skills: ['analytics'],
          category: { name: 'CRM' },
        },
      ],
    } as any;

    const [target] = service.buildCatalogTargets([], [servicePackage]);
    const result = service.scoreCandidate(
      target,
      service.normalizeText('CRM data statuses and analytics are missing'),
    );

    expect(target.packageId).toBe('package-id');
    expect(result.packageId).toBe('package-id');
    expect(result.score).toBeGreaterThan(0);
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

  it('accepts packageId from AI recommendation output', async () => {
    const servicePackage = {
      id: 'package-id',
      name: 'CRM Silver',
      description: 'Advanced CRM launch package',
      price: 100000,
      tags: ['CRM', 'analytics'],
      packageType: 'Silver',
      category: { name: 'Packages' },
      services: [],
    } as any;
    const targets = service.buildCatalogTargets([], [servicePackage]);
    llmProxy.chat.mockResolvedValueOnce({
      content:
        '{"recommendations":[{"packageId":"package-id","priority":"medium","rationale":"Best package fit","diagnosticSignals":["crm_quality"]}]}',
    });

    const result = await service.generateAiRecommendations(
      {
        userId: 'user-id',
        diagnostics: ['CRM data quality'],
      },
      targets,
      'crm data quality',
    );

    expect(result[0]).toMatchObject({
      serviceId: null,
      packageId: 'package-id',
      targetType: 'package',
      rationale: 'Best package fit',
    });
  });

  it('does not declare user diagnostics as no_pii for proxy calls', async () => {
    llmProxy.chat.mockResolvedValueOnce({ content: '{"recommendations":[]}' });

    await service.generateAiRecommendations(
      {
        userId: 'user-id',
        clientProfile: { contact: 'client@example.com' },
        diagnostics: ['Call +7 999 111 22 33'],
      },
      [],
      'call client',
    );

    expect(llmProxy.chat).toHaveBeenCalledWith(
      expect.not.objectContaining({ declaredDataClass: expect.anything() }),
    );
  });
});
