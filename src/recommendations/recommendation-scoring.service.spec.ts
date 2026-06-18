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

  it('accepts serviceId from AI recommendation output', async () => {
    const candidate = {
      id: 'service-id',
      name: 'CRM Silver',
      description: 'Advanced CRM launch service',
      type: ServiceType.Service,
      skills: ['CRM', 'analytics'],
      category: { name: 'Пакет услуг' },
    } as any;
    llmProxy.chat.mockResolvedValueOnce({
      content:
        '{"recommendations":[{"serviceId":"service-id","priority":"medium","rationale":"Best service fit","diagnosticSignals":["crm_quality"]}]}',
    });

    const result = await service.generateAiRecommendations(
      {
        userId: 'user-id',
        diagnostics: ['CRM data quality'],
      },
      [candidate],
      'crm data quality',
    );

    expect(result[0]).toMatchObject({
      serviceId: 'service-id',
    });
    expect(result[0].rationale).toMatch(/[а-яё]/i);
  });

  it('keeps a valid AI-only semantic recommendation with Russian rationale', async () => {
    const candidate = {
      id: 'semantic-service-id',
      name: 'Сложная внедренческая услуга',
      description: 'Индивидуальный формат без ключевых слов диагностики',
      type: ServiceType.Service,
      skills: [],
      category: null,
    } as any;
    llmProxy.chat.mockResolvedValueOnce({
      content:
        '{"recommendations":[{"serviceId":"semantic-service-id","priority":"medium","rationale":"Подходит, потому что нужна внедренческая настройка под клиента.","diagnosticSignals":["custom_fit"]}]}',
    });

    const result = await service.generateAiRecommendations(
      {
        userId: 'user-id',
        diagnostics: [
          'client needs a bespoke implementation path внедренческая настройка',
        ],
      },
      [candidate],
      [
        'client needs a bespoke implementation path',
        'внедренческая настройка',
      ].join(' '),
    );

    expect(result[0]).toMatchObject({
      serviceId: 'semantic-service-id',
      score: 6,
      diagnosticSignals: ['ai_generated', 'ai_semantic_match', 'custom_fit'],
    });
  });

  it('rejects AI-only semantic recommendations without service-specific evidence', async () => {
    const candidate = {
      id: 'unrelated-service-id',
      name: 'Юридический документ',
      description: 'Договор и правовая проверка',
      type: ServiceType.Document,
      skills: ['legal'],
      category: null,
    } as any;
    llmProxy.chat.mockResolvedValueOnce({
      content:
        '{"recommendations":[{"serviceId":"unrelated-service-id","priority":"medium","rationale":"Подходит, потому что закрывает описанный клиентом сценарий.","diagnosticSignals":["custom_fit"]}]}',
    });

    const result = await service.generateAiRecommendations(
      {
        userId: 'user-id',
        diagnostics: ['client needs CRM implementation'],
      },
      [candidate],
      'client needs CRM implementation',
    );

    expect(result).toEqual([]);
  });

  it('resolves AI recommendation output to packageId for package candidates', async () => {
    const candidate = {
      id: 'package-id',
      serviceId: null,
      packageId: 'package-id',
      name: 'CRM Package',
      description: 'CRM package with setup and telephony',
      type: 'Пакет услуг',
      skills: ['CRM', 'telephony'],
      category: { name: 'Пакет услуг' },
      coveredServiceIds: ['service-id'],
    } as any;
    llmProxy.chat.mockResolvedValueOnce({
      content:
        '{"recommendations":[{"serviceId":"package-id","priority":"urgent","rationale":"Best package fit","diagnosticSignals":["crm_quality"]}]}',
    });

    const result = await service.generateAiRecommendations(
      {
        userId: 'user-id',
        diagnostics: ['CRM data quality'],
      },
      [candidate],
      'crm data quality',
    );

    expect(result[0]).toMatchObject({
      serviceId: null,
      packageId: 'package-id',
      coveredServiceIds: ['service-id'],
    });
    expect(result[0].rationale).toMatch(/[а-яё]/i);
  });

  it('filters AI recommendations that do not match diagnostics locally', async () => {
    const relevantCandidate = {
      id: 'crm-service-id',
      name: 'CRM Quality',
      description: 'CRM data cleanup and status audit',
      type: ServiceType.Service,
      skills: ['CRM'],
      category: null,
    } as any;
    const unrelatedCandidate = {
      id: 'unrelated-service-id',
      name: 'Legal document',
      description: 'Contract template and legal review',
      type: ServiceType.Document,
      skills: ['legal'],
      category: null,
    } as any;
    llmProxy.chat.mockResolvedValueOnce({
      content:
        '{"recommendations":[{"serviceId":"crm-service-id","priority":"medium","rationale":"Подходит для CRM","diagnosticSignals":["crm_quality"]},{"serviceId":"unrelated-service-id","priority":"medium","rationale":"Looks good","diagnosticSignals":["crm_quality"]}]}',
    });

    const result = await service.generateAiRecommendations(
      {
        userId: 'user-id',
        diagnostics: ['CRM data quality'],
      },
      [relevantCandidate, unrelatedCandidate],
      'crm data quality',
    );

    expect(result.map((item) => item.serviceId)).toEqual(['crm-service-id']);
  });

  it('ignores AI service ids outside the catalog slice sent to the model', async () => {
    const candidates = Array.from({ length: 51 }, (_, index) => ({
      id: `crm-service-${index}`,
      name: `CRM setup ${index}`,
      description: 'CRM data quality and setup',
      type: ServiceType.Service,
      skills: ['CRM'],
      category: null,
    })) as any[];
    llmProxy.chat.mockResolvedValueOnce({
      content:
        '{"recommendations":[{"serviceId":"crm-service-50","priority":"medium","rationale":"Подходит для CRM","diagnosticSignals":["crm_quality"]}]}',
    });

    const result = await service.generateAiRecommendations(
      {
        userId: 'user-id',
        diagnostics: ['CRM data quality'],
      },
      candidates,
      'crm data quality',
    );

    expect(result).toEqual([]);
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
