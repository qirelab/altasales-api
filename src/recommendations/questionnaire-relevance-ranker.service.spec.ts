import { ServiceType } from '../services/entities/service-type.enum';
import { RecommendationPriority } from './entities/recommendation-priority.enum';
import { QuestionnaireRelevanceRankerService } from './questionnaire-relevance-ranker.service';
import {
  RECOMMENDATION_CATALOG,
  RECOMMENDATION_CATALOG_ENTRIES,
} from './recommendation-catalog.registry';
import {
  GeneratedRecommendationItem,
  ServiceCandidate,
} from './recommendation-scoring.service';

describe('QuestionnaireRelevanceRankerService', () => {
  const service = (id: string, name: string): ServiceCandidate =>
    ({
      id,
      name,
      description: name,
      type: ServiceType.Service,
      price: 0,
      skills: [],
      category: null,
    }) as unknown as ServiceCandidate;

  const services = [
    service('from-zero', 'Отдел продаж с нуля'),
    service('base-setup', 'Базовая настройка работы отдела продаж'),
    service('docs-package', 'Пакет документов отдела продаж'),
    service('training-3m', 'Пакет обучения на 3 месяца'),
    service('training-1m', 'Пакет обучения на месяц'),
    service('crm-start', 'CRM Старт'),
    service('crm-bronze', 'CRM Бронза'),
    service('crm-silver', 'CRM Серебро'),
    service('crm-gold', 'CRM Золото'),
    service('crm-audit', 'Аудит CRM'),
    service('crm-funnels', 'Настройка воронок сделок (до 3 шт)'),
    service('crm-tech-spec', 'Подготовка технического задания'),
    service('crm-report-setup', 'Настройка отчёта'),
    service('crm-deals-report', 'Отчет по ведению сделок в CRM'),
    service('sales-script', 'Скрипт продаж'),
    service('turnkey-hiring', 'Подбор под ключ'),
    service('telephony', 'Интеграция телефонии'),
    service('messenger', 'Интеграция мессенджера'),
    service('automation', 'Настройка роботов для автоматизации'),
    service(
      'calls-report',
      'Отчёт с оценкой прослушанных разговоров с клиентами',
    ),
    service(
      'messenger-report',
      'Отчёт с оценкой проанализированных переписок с клиентами',
    ),
    service('dashboard', 'Дашборд ОП'),
    service('ai-rop', 'ИИ РОП'),
    service('quality', 'На Контроле + Рубичат'),
    service('sales-head', 'Руководитель отдела продаж'),
    service('document-request', 'Документ под запрос'),
    service('financial-director', 'Финансовый директор'),
  ];

  const components = (overrides: Partial<Record<string, boolean>> = {}) => ({
    crm: false,
    telephony: false,
    messenger: false,
    voiceChatbot: false,
    contactDatabase: false,
    salesManager: false,
    trainingSystem: false,
    analytics: false,
    scripts: false,
    callAnalysis: false,
    salesDocuments: false,
    salesHead: false,
    ...overrides,
  });

  const scoringService = {
    scoreService: (
      candidate: ServiceCandidate,
    ): GeneratedRecommendationItem => ({
      serviceId: candidate.id,
      serviceName: candidate.name,
      priority: RecommendationPriority.Low,
      rationale: 'fallback',
      diagnosticSignals: [],
      score: 0,
    }),
    normalizeSignals: (signals: string[]): string[] =>
      Array.from(new Set(signals.filter(Boolean))),
  };

  let ranker: QuestionnaireRelevanceRankerService;

  beforeEach(() => {
    ranker = new QuestionnaireRelevanceRankerService(scoringService as any);
  });

  it('resolves configured catalog items by stable ID after a display name change', () => {
    const configuredServices = RECOMMENDATION_CATALOG_ENTRIES.map(
      (entry) =>
        ({
          ...service(entry.id, `Переименованная позиция ${entry.id}`),
          serviceId: entry.kind === 'service' ? entry.id : null,
          packageId: entry.kind === 'package' ? entry.id : null,
        }) as ServiceCandidate,
    );

    const result = ranker.rankRecommendations(
      {
        userId: 'user-id',
        clientProfile: {
          productStage: 'new',
          desiredResult: { description: 'Отдела продаж нет, запускаем с нуля' },
          components: components(),
          componentsToAdd: components(),
        },
        persist: false,
      },
      configuredServices,
      [],
      '',
    );

    expect(result[0].packageId).toBe(
      RECOMMENDATION_CATALOG.salesDepartmentFromZero.id,
    );
  });

  it('fails fast when a configured catalog ID is missing', () => {
    const configuredServices = RECOMMENDATION_CATALOG_ENTRIES.filter(
      (entry) => entry.id !== RECOMMENDATION_CATALOG.crmAudit.id,
    ).map(
      (entry) =>
        ({
          ...service(entry.id, entry.displayName),
          serviceId: entry.kind === 'service' ? entry.id : null,
          packageId: entry.kind === 'package' ? entry.id : null,
        }) as ServiceCandidate,
    );

    expect(() =>
      ranker.rankRecommendations(
        { userId: 'user-id', clientProfile: {}, persist: false },
        configuredServices,
        [],
        '',
      ),
    ).toThrow(`Recommendation catalog item is missing: Аудит CRM`);
  });

  it('does not require superseded call-analysis services in the configured catalog', () => {
    const configuredServices = RECOMMENDATION_CATALOG_ENTRIES.filter(
      (entry) =>
        ![
          RECOMMENDATION_CATALOG.communicationQualityControl.id,
          RECOMMENDATION_CATALOG.callAnalysis.id,
        ].includes(entry.id),
    ).map(
      (entry) =>
        ({
          ...service(entry.id, entry.displayName),
          serviceId: entry.kind === 'service' ? entry.id : null,
          packageId: entry.kind === 'package' ? entry.id : null,
        }) as ServiceCandidate,
    );

    expect(() =>
      ranker.rankRecommendations(
        { userId: 'user-id', clientProfile: {}, persist: false },
        configuredServices,
        [],
        '',
      ),
    ).not.toThrow();
  });

  it('filters services that are clearly too basic for a mature sales department', () => {
    const result = ranker.rankRecommendations(
      {
        userId: 'user-id',
        clientProfile: {
          productStage: 'Уже продаю',
          targetResult: 'Масштабировать отдел продаж с 8 менеджерами',
          desiredRevenue: 15000000,
          calculatedManagersCount: 8,
          desiredSalesDepartment: ['CRM', 'Аналитика', 'РОП'],
        },
        persist: false,
      },
      services,
      [],
      '',
      6,
    );

    expect(result.some((item) => item.serviceId === 'from-zero')).toBe(false);
    expect(result.some((item) => item.serviceId === 'crm-start')).toBe(false);
    expect(result.some((item) => item.serviceId === 'crm-bronze')).toBe(false);
  });

  it('boosts services explicitly requested by questionnaire answers', () => {
    const result = ranker.rankRecommendations(
      {
        userId: 'user-id',
        clientProfile: {
          productStage: 'Уже продаю',
          targetResult: 'Навести порядок в работе 2 менеджеров',
          desiredRevenue: 4000000,
          calculatedManagersCount: 2,
          leadGenerationType: 'Входящая',
          desiredSalesDepartment: ['CRM', 'Телефония', 'Мессенджер', 'Скрипты'],
        },
        persist: false,
      },
      services,
      [],
      '',
      5,
    );

    expect(result.map((item) => item.serviceId)).toEqual(
      expect.arrayContaining(['crm-bronze', 'telephony', 'messenger']),
    );
    expect(result[0].serviceId).toBe('crm-bronze');
  });

  it('uses canonical questionnaire component answers when boosting services', () => {
    const result = ranker.rankRecommendations(
      {
        userId: 'user-id',
        clientProfile: {
          productStage: 'existing',
          desiredResult: {
            period: '3m',
            description: 'Навести порядок в работе 2 менеджеров',
          },
          targetRevenue: 4000000,
          leadGenerationTypes: ['inbound'],
          components: components({
            crm: true,
            telephony: true,
            messenger: true,
            scripts: true,
          }),
        },
        persist: false,
      },
      services,
      [],
      '',
      5,
    );

    expect(result.map((item) => item.serviceId)).toEqual(
      expect.arrayContaining(['crm-bronze', 'telephony', 'messenger']),
    );
    expect(result[0].serviceId).toBe('crm-bronze');
  });

  it('uses componentsToAdd for the new existing-product flow', () => {
    const result = ranker.rankRecommendations(
      {
        userId: 'user-id',
        clientProfile: {
          productStage: 'existing',
          desiredResult: {
            period: '3m',
            description: 'Усилить действующий отдел продаж',
          },
          targetRevenue: 4000000,
          components: components({
            crm: true,
            messenger: true,
          }),
          componentsToAdd: components({
            telephony: true,
          }),
        },
        persist: false,
      },
      services,
      [],
      '',
      5,
    );

    const serviceIds = result.map((item) => item.serviceId);

    expect(serviceIds).toContain('telephony');
    expect(serviceIds).not.toContain('messenger');
    expect(serviceIds).not.toContain('crm-start');
    expect(serviceIds).not.toContain('crm-bronze');
  });

  it('filters CRM Start even when the LLM recommends it for an existing CRM', () => {
    const result = ranker.rankRecommendations(
      {
        userId: 'user-id',
        clientProfile: {
          productStage: 'existing',
          leadGenerationTypes: ['inbound'],
          components: components({ crm: true }),
          componentsToAdd: components({ analytics: true }),
        },
        persist: false,
      },
      services,
      [
        {
          serviceId: 'crm-start',
          serviceName: 'CRM Старт',
          priority: RecommendationPriority.Urgent,
          rationale: 'llm',
          diagnosticSignals: ['ai_generated'],
          score: 100,
        },
      ],
      '',
      5,
    );

    expect(result.map((item) => item.serviceId)).not.toContain('crm-start');
  });

  it('maps an existing CRM to audit and analysis without reimplementation', () => {
    const result = ranker.rankRecommendations(
      {
        userId: 'user-id',
        clientProfile: {
          productStage: 'existing',
          components: components({ crm: true }),
          componentsToAdd: components(),
          desiredResult: {
            description: 'Проверить качество ведения сделок в CRM',
          },
        },
        persist: false,
      },
      services,
      [],
      '',
      7,
    );

    const serviceIds = result.map((item) => item.serviceId);
    expect(serviceIds).toEqual(
      expect.arrayContaining(['crm-audit', 'crm-deals-report']),
    );
    expect(serviceIds).not.toContain('crm-start');
  });

  it('uses selected analytics to analyze existing sales data sources', () => {
    const result = ranker.rankRecommendations(
      {
        userId: 'user-id',
        clientProfile: {
          productStage: 'existing',
          components: components({
            crm: true,
            telephony: true,
            messenger: true,
          }),
          componentsToAdd: components({ analytics: true, salesHead: true }),
          desiredResult: {
            description:
              'Хочу усилить РОПа и видеть аналитику по текущему отделу продаж',
          },
          calculatedManagersCount: 8,
        },
        persist: false,
      },
      services,
      [],
      '',
      10,
    );

    const serviceIds = result.map((item) => item.serviceId);
    expect(serviceIds).toEqual(
      expect.arrayContaining([
        'dashboard',
        'crm-deals-report',
        'calls-report',
        'messenger-report',
      ]),
    );
    expect(serviceIds).toContain('crm-audit');
  });

  it('always analyzes existing components even when analytics is not selected', () => {
    const result = ranker.rankRecommendations(
      {
        userId: 'user-id',
        clientProfile: {
          productStage: 'existing',
          components: components({
            crm: true,
            telephony: true,
            messenger: true,
          }),
          componentsToAdd: components(),
          desiredResult: {
            description: 'Хочу понять, что можно улучшить в отделе продаж',
          },
        },
        persist: false,
      },
      services,
      [],
      '',
      10,
    );

    const serviceIds = result.map((item) => item.serviceId);
    expect(serviceIds).toEqual(
      expect.arrayContaining([
        'crm-audit',
        'crm-deals-report',
        'calls-report',
        'messenger-report',
      ]),
    );
    expect(serviceIds).not.toContain('crm-start');
  });

  it('maps a desired CRM to implementation without audit recommendations', () => {
    const result = ranker.rankRecommendations(
      {
        userId: 'user-id',
        clientProfile: {
          productStage: 'existing',
          components: components(),
          componentsToAdd: components({ crm: true }),
        },
        persist: false,
      },
      services,
      [],
      '',
      7,
    );

    const serviceIds = result.map((item) => item.serviceId);
    expect(serviceIds).toContain('crm-start');
    expect(serviceIds).not.toEqual(
      expect.arrayContaining(['crm-audit', 'crm-deals-report']),
    );
  });

  it('keeps both analysis and implementation when CRM is in both sets', () => {
    const result = ranker.rankRecommendations(
      {
        userId: 'user-id',
        clientProfile: {
          productStage: 'existing',
          components: components({ crm: true }),
          componentsToAdd: components({ crm: true }),
        },
        persist: false,
      },
      services,
      [],
      '',
      7,
    );

    const serviceIds = result.map((item) => item.serviceId);
    expect(serviceIds).toEqual(
      expect.arrayContaining(['crm-audit', 'crm-deals-report']),
    );
    expect(
      serviceIds.some((id) =>
        ['crm-start', 'crm-bronze', 'crm-silver', 'crm-gold'].includes(id!),
      ),
    ).toBe(true);
  });

  it('keeps CRM Start when existing CRM needs bundled communication integrations', () => {
    const result = ranker.rankRecommendations(
      {
        userId: 'user-id',
        clientProfile: {
          productStage: 'existing',
          components: components({ crm: true }),
          componentsToAdd: components({ telephony: true, messenger: true }),
        },
        persist: false,
      },
      services,
      [
        {
          serviceId: 'crm-start',
          serviceName: 'CRM Старт',
          priority: RecommendationPriority.Urgent,
          rationale: 'package covers the desired integrations',
          diagnosticSignals: ['ai_generated'],
          score: 100,
        },
      ],
      '',
      5,
    );

    expect(result.map((item) => item.serviceId)).toContain('crm-start');
  });

  it('keeps components as desired tools for a new product', () => {
    const result = ranker.rankRecommendations(
      {
        userId: 'user-id',
        clientProfile: {
          productStage: 'new',
          components: components({ crm: true, telephony: true }),
          componentsToAdd: components(),
        },
        persist: false,
      },
      services,
      [],
      '',
      5,
    );

    expect(result.map((item) => item.serviceId)).toEqual(
      expect.arrayContaining(['crm-start', 'telephony']),
    );
  });

  it('uses componentsToAdd only for an existing-stage split flow', () => {
    const result = ranker.rankRecommendations(
      {
        userId: 'user-id',
        clientProfile: {
          productStage: 'new',
          desiredResult: {
            description: 'Отдела продаж нет, нужно построить его с нуля',
          },
          components: components({
            crm: true,
            telephony: true,
            trainingSystem: true,
          }),
          componentsToAdd: components({
            messenger: true,
          }),
        },
        persist: false,
      },
      services,
      [],
      '',
    );

    const serviceIds = result.map((item) => item.serviceId);
    expect(serviceIds).toEqual(
      expect.arrayContaining(['from-zero', 'crm-start', 'training-3m']),
    );
    expect(serviceIds).toContain('telephony');
    expect(serviceIds).not.toContain('messenger');
    expect(serviceIds).not.toEqual(
      expect.arrayContaining(['crm-audit', 'crm-deals-report']),
    );
  });

  it('uses the golden reference for a new B2B outbound full sales department setup', () => {
    const result = ranker.rankRecommendations(
      {
        userId: 'user-id',
        clientProfile: {
          salesDirection: 'B2B',
          product: 'Строительные материалы',
          productStage: 'new',
          leadGenerationTypes: ['outbound'],
          components: components({
            crm: true,
            telephony: true,
            messenger: true,
            contactDatabase: true,
            salesManager: true,
            trainingSystem: true,
            analytics: true,
            salesHead: true,
          }),
        },
        persist: false,
      },
      services,
      [],
      '',
      6,
    );

    expect(result.map((item) => item.serviceId)).toEqual([
      'from-zero',
      'sales-head',
      'training-3m',
      'crm-start',
      'turnkey-hiring',
      'telephony',
    ]);
    expect(result[0].diagnosticSignals).toContain(
      'ideal_reference:new_outbound_full_sales_department',
    );
  });

  it('expands a golden reference scenario with relevant questionnaire matches', () => {
    const result = ranker.rankRecommendations(
      {
        userId: 'user-id',
        clientProfile: {
          salesDirection: 'B2B',
          product: 'Строительные материалы',
          productStage: 'new',
          leadGenerationTypes: ['outbound'],
          components: components({
            crm: true,
            telephony: true,
            messenger: true,
            contactDatabase: true,
            salesManager: true,
            trainingSystem: true,
            analytics: true,
            salesHead: true,
          }),
        },
        persist: false,
      },
      services,
      [],
      '',
      10,
    );

    expect(result.map((item) => item.serviceId)).toEqual([
      'from-zero',
      'sales-head',
      'training-3m',
      'crm-start',
      'turnkey-hiring',
      'telephony',
      'messenger',
      'dashboard',
    ]);
  });

  it('does not map external AI-analysis labels to internal golden recommendations', () => {
    const result = ranker.rankRecommendations(
      {
        userId: 'user-id',
        clientProfile: {
          salesDirection: 'B2B',
          product: 'Строительные материалы',
          productStage: 'new',
          leadGenerationTypes: ['outbound'],
          components: components({
            crm: true,
            telephony: true,
            messenger: true,
            contactDatabase: true,
            salesManager: true,
            trainingSystem: true,
            analytics: true,
            salesHead: true,
          }),
        },
        persist: false,
      },
      services,
      [],
      '',
      10,
    );

    expect(result.map((item) => item.serviceId)).not.toEqual(
      expect.arrayContaining(['crm-deals-report', 'document-request']),
    );
    const dashboard = result.find((item) => item.serviceId === 'dashboard');
    expect(dashboard?.diagnosticSignals ?? []).not.toContain(
      'ideal_reference:new_outbound_full_sales_department',
    );
    expect(result.flatMap((item) => item.diagnosticSignals)).not.toEqual(
      expect.arrayContaining([
        'ИИ анализ CRM',
        'ИИ анализ дашборда',
        'ИИ анализ документов',
      ]),
    );
  });

  it('does not keep external AI-analysis labels in catalog aliases', () => {
    const aliases = RECOMMENDATION_CATALOG_ENTRIES.flatMap(
      (entry) => entry.legacyAliases,
    ).join(' ');

    expect(aliases).not.toContain('ии анализ crm');
    expect(aliases).not.toContain('ии анализ дашборда');
    expect(aliases).not.toContain('ии анализ документов');
  });

  it('replaces the legacy quality-control recommendation with AI call analysis', () => {
    const aiAnalysisServices = [
      service('ai-calls', 'ИИ анализ звонков и менеджеров'),
      service(
        'calls-report',
        'Отчёт с оценкой прослушанных разговоров с клиентами',
      ),
      service('quality', 'На Контроле + Рубичат'),
    ];

    const result = ranker.rankRecommendations(
      {
        userId: 'user-id',
        clientProfile: {
          productStage: 'existing',
          components: components(),
          componentsToAdd: components({ callAnalysis: true }),
        },
        persist: false,
      },
      aiAnalysisServices,
      [],
      '',
      5,
    );

    expect(result.map((item) => item.serviceId)).toEqual(['ai-calls']);
    expect(result.map((item) => item.serviceId)).not.toContain('quality');
  });

  it('keeps a strong legacy recommendation when its replacement is below the score threshold', () => {
    const candidates = [
      service('office', 'Офис'),
      service('office-pro', 'Офис PRO'),
    ];

    const result = ranker.rankRecommendations(
      {
        userId: 'user-id',
        clientProfile: {
          productStage: 'existing',
          components: components(),
          componentsToAdd: components({ salesManager: true }),
        },
        persist: false,
      },
      candidates,
      [
        {
          serviceId: 'office',
          serviceName: 'Офис',
          priority: RecommendationPriority.Low,
          rationale: 'weak replacement',
          diagnosticSignals: [],
          score: -100,
        },
        {
          serviceId: 'office-pro',
          serviceName: 'Офис PRO',
          priority: RecommendationPriority.Medium,
          rationale: 'strong alternative',
          diagnosticSignals: [],
          score: 30,
        },
      ],
      '',
      5,
    );

    expect(result.map((item) => item.serviceId)).toEqual(['office-pro']);
    expect(result[0].score).toBeGreaterThan(20);
  });

  it.each([
    ['crm', 'ИИ анализ CRM'],
    ['analytics', 'ИИ анализ дашборда'],
    ['salesDocuments', 'ИИ анализ документов'],
    ['telephony', 'ИИ анализ звонков и менеджеров'],
  ])(
    'adds %s AI analysis when that component already exists',
    (component, expectedServiceName) => {
      const result = ranker.rankRecommendations(
        {
          userId: 'user-id',
          clientProfile: {
            productStage: 'existing',
            components: components({ [component]: true }),
            componentsToAdd: components(),
          },
          persist: false,
        },
        [
          service('ai-crm', 'ИИ анализ CRM'),
          service('ai-dashboard', 'ИИ анализ дашборда'),
          service('ai-documents', 'ИИ анализ документов'),
          service('ai-calls', 'ИИ анализ звонков и менеджеров'),
        ],
        [],
        '',
      );

      expect(result.map((item) => item.serviceName)).toContain(
        expectedServiceName,
      );
    },
  );

  it('keeps call analysis, telephony integration and messenger integration as separate recommendations', () => {
    const result = ranker.rankRecommendations(
      {
        userId: 'user-id',
        clientProfile: {
          productStage: 'existing',
          components: components({ callAnalysis: true }),
          componentsToAdd: components({
            telephony: true,
            messenger: true,
          }),
        },
        persist: false,
      },
      [
        service('ai-calls', 'ИИ анализ звонков и менеджеров'),
        service('telephony', 'Интеграция телефонии'),
        service('messenger', 'Интеграция мессенджера'),
      ],
      [],
      '',
    );

    expect(result.map((item) => item.serviceId)).toEqual([
      'ai-calls',
      'telephony',
      'messenger',
    ]);
  });

  it('keeps only the default Office hiring format when alternatives also match', () => {
    const result = ranker.rankRecommendations(
      {
        userId: 'user-id',
        clientProfile: {
          productStage: 'existing',
          components: components(),
          componentsToAdd: components({ salesManager: true }),
        },
        persist: false,
      },
      [
        service('office', 'Офис'),
        service('office-pro', 'Офис PRO'),
        service('online', 'Стандарт Online'),
      ],
      [],
      '',
    );

    expect(result.map((item) => item.serviceId)).toEqual(['office']);
  });

  it('fills the limit after collapsing alternative hiring formats', () => {
    const candidates = [
      service('office', 'Офис'),
      service('office-pro', 'Офис PRO'),
      service('service-1', 'Услуга 1'),
      service('service-2', 'Услуга 2'),
      service('service-3', 'Услуга 3'),
      service('service-4', 'Услуга 4'),
    ];
    const ranked = candidates.map((candidate, index) => ({
      serviceId: candidate.id,
      serviceName: candidate.name,
      priority: RecommendationPriority.Medium,
      rationale: 'llm',
      diagnosticSignals: ['ai_generated'],
      score: 100 - index,
    }));

    const result = ranker.rankRecommendations(
      {
        userId: 'user-id',
        clientProfile: {
          productStage: 'existing',
          desiredResult: { description: 'Усилить продажи' },
        },
        persist: false,
      },
      candidates,
      ranked,
      '',
      5,
    );

    expect(result.map((item) => item.serviceId)).toEqual([
      'office',
      'service-1',
      'service-2',
      'service-3',
      'service-4',
    ]);
  });

  it('filters weak unselected fallback matches', () => {
    const weakFallbackRanker = new QuestionnaireRelevanceRankerService({
      ...scoringService,
      scoreService: (candidate: ServiceCandidate) => ({
        serviceId: candidate.id,
        serviceName: candidate.name,
        priority: RecommendationPriority.Urgent,
        rationale: 'generic diagnostic match',
        diagnosticSignals: ['analytics_visibility'],
        score: 21,
      }),
    } as any);

    const result = weakFallbackRanker.rankRecommendations(
      {
        userId: 'user-id',
        clientProfile: {
          productStage: 'existing',
          components: components(),
          componentsToAdd: components(),
        },
        persist: false,
      },
      [service('report-setup', 'Настройка отчёта')],
      [],
      '',
    );

    expect(result).toEqual([]);
  });

  it('keeps the golden reference while adapting training to the requested period', () => {
    const result = ranker.rankRecommendations(
      {
        userId: 'user-id',
        clientProfile: {
          salesDirection: 'B2B',
          productStage: 'new',
          desiredResult: {
            period: '1m',
          },
          leadGenerationTypes: ['outbound'],
          components: components({
            crm: true,
            telephony: true,
            messenger: true,
            contactDatabase: true,
            salesManager: true,
            trainingSystem: true,
            analytics: true,
            salesHead: true,
          }),
        },
        persist: false,
      },
      services,
      [],
      '',
      6,
    );

    expect(result.map((item) => item.serviceId)).toContain('training-1m');
    expect(result.map((item) => item.serviceId)).not.toContain('training-3m');
  });

  it('fails when a required golden reference item is missing from the catalog', () => {
    expect(() =>
      ranker.rankRecommendations(
        {
          userId: 'user-id',
          clientProfile: {
            productStage: 'new',
            leadGenerationTypes: ['outbound'],
            components: components({
              crm: true,
              telephony: true,
              messenger: true,
              contactDatabase: true,
              trainingSystem: true,
              analytics: true,
              salesHead: true,
            }),
          },
          persist: false,
        },
        services.filter((candidate) => candidate.id !== 'training-3m'),
        [],
        '',
        7,
      ),
    ).toThrow('Golden recommendation catalog item is missing');
  });

  it('prefers exact golden reference names over fallback aliases', () => {
    const result = ranker.rankRecommendations(
      {
        userId: 'user-id',
        clientProfile: {
          salesDirection: 'B2B',
          product: 'Строительные материалы',
          productStage: 'new',
          leadGenerationTypes: ['outbound'],
          components: components({
            crm: true,
            telephony: true,
            messenger: true,
            contactDatabase: true,
            salesManager: true,
            trainingSystem: true,
            analytics: true,
            salesHead: true,
          }),
        },
        persist: false,
      },
      [service('exact-from-zero', 'Пакет ОП с нуля'), ...services],
      [],
      '',
      6,
    );

    expect(result[0].serviceId).toBe('exact-from-zero');
  });

  it('applies the golden reference to similar non-B2B questionnaires', () => {
    const result = ranker.rankRecommendations(
      {
        userId: 'user-id',
        clientProfile: {
          salesDirection: 'B2C',
          product: 'Строительные материалы',
          productStage: 'new',
          leadGenerationTypes: ['outbound'],
          components: components({
            crm: true,
            telephony: true,
            messenger: true,
            contactDatabase: true,
            salesManager: true,
            trainingSystem: true,
            analytics: true,
            salesHead: true,
          }),
        },
        persist: false,
      },
      services,
      [],
      '',
      6,
    );

    expect(result.flatMap((item) => item.diagnosticSignals)).toContain(
      'ideal_reference:new_outbound_full_sales_department',
    );
  });

  it('keeps golden reference items above expanded LLM-ranked candidates', () => {
    const customCandidate = service(
      'custom-growth-audit',
      'Индивидуальный аудит роста продаж',
    );
    const result = ranker.rankRecommendations(
      {
        userId: 'user-id',
        clientProfile: {
          salesDirection: 'B2B',
          product: 'Строительные материалы',
          productStage: 'new',
          leadGenerationTypes: ['outbound'],
          desiredResult: {
            description: 'Дополнительно нужен аудит роста продаж',
          },
          components: components({
            crm: true,
            telephony: true,
            messenger: true,
            contactDatabase: true,
            salesManager: true,
            trainingSystem: true,
            analytics: true,
            salesHead: true,
          }),
        },
        persist: false,
      },
      [...services, customCandidate],
      [
        {
          serviceId: 'custom-growth-audit',
          serviceName: 'Индивидуальный аудит роста продаж',
          priority: RecommendationPriority.Urgent,
          rationale: 'LLM found a custom fit from questionnaire text',
          diagnosticSignals: ['ai_generated', 'custom_growth_fit'],
          score: 125,
        },
      ],
      '',
      10,
    );

    expect(result.map((item) => item.serviceId).slice(0, 3)).toEqual([
      'from-zero',
      'sales-head',
      'training-3m',
    ]);
    expect(result.map((item) => item.serviceId)).toContain(
      'custom-growth-audit',
    );
    expect(result.flatMap((item) => item.diagnosticSignals)).toContain(
      'ideal_reference:new_outbound_full_sales_department',
    );
  });

  it('does not collapse an all-components questionnaire into a narrow golden scenario', () => {
    const result = ranker.rankRecommendations(
      {
        userId: 'user-id',
        clientProfile: {
          productStage: 'new',
          leadGenerationTypes: ['outbound'],
          components: components({
            crm: true,
            telephony: true,
            messenger: true,
            voiceChatbot: true,
            contactDatabase: true,
            salesManager: true,
            trainingSystem: true,
            analytics: true,
            scripts: true,
            callAnalysis: true,
            salesDocuments: true,
            salesHead: true,
          }),
        },
        persist: false,
      },
      services,
      [],
      '',
    );

    expect(result.length).toBeGreaterThan(7);
    expect(result.flatMap((item) => item.diagnosticSignals)).not.toContain(
      'ideal_reference:new_outbound_full_sales_department',
    );
  });

  it('does not cap a relevant result before package compaction', () => {
    const ranked = services.map((candidate, index) => ({
      serviceId: candidate.id,
      serviceName: candidate.name,
      priority: RecommendationPriority.Medium,
      rationale: 'llm',
      diagnosticSignals: ['ai_generated'],
      score: 100 - index,
    }));

    const result = ranker.rankRecommendations(
      {
        userId: 'user-id',
        clientProfile: {
          productStage: 'existing',
          desiredResult: { description: 'Усилить продажи' },
        },
        persist: false,
      },
      services,
      ranked,
      '',
    );

    expect(result.length).toBeGreaterThan(7);
  });

  it('keeps only one sales-head variant in the first result', () => {
    const result = ranker.rankRecommendations(
      {
        userId: 'user-id',
        clientProfile: {
          productStage: 'existing',
          components: components(),
          componentsToAdd: components({ salesHead: true }),
        },
        persist: false,
      },
      services,
      [
        {
          serviceId: 'ai-rop',
          serviceName: 'ИИ РОП',
          priority: RecommendationPriority.Urgent,
          rationale: 'llm',
          diagnosticSignals: ['ai_generated'],
          score: 100,
        },
        {
          serviceId: 'sales-head',
          serviceName: 'Руководитель отдела продаж',
          priority: RecommendationPriority.Urgent,
          rationale: 'llm',
          diagnosticSignals: ['ai_generated'],
          score: 99,
        },
      ],
      '',
      7,
    );

    expect(
      result.filter((item) =>
        ['ai-rop', 'sales-head'].includes(item.serviceId!),
      ),
    ).toHaveLength(1);
  });

  it('uses the golden reference for an existing B2B inbound managed sales department', () => {
    const result = ranker.rankRecommendations(
      {
        userId: 'user-id',
        clientProfile: {
          salesDirection: 'B2B',
          product: 'Бухгалтерские услуги',
          productStage: 'existing',
          leadGenerationTypes: ['inbound'],
          components: components({
            telephony: true,
            messenger: true,
            trainingSystem: true,
            analytics: true,
            salesHead: true,
          }),
        },
        persist: false,
      },
      services,
      [],
      '',
      7,
    );

    expect(result.map((item) => item.serviceId)).toEqual([
      'crm-start',
      'training-3m',
      'sales-head',
      'telephony',
      'messenger',
      'dashboard',
    ]);
    expect(result[0].diagnosticSignals).toContain(
      'ideal_reference:existing_inbound_managed_sales_department',
    );
  });

  it('does not recommend contact databases for inbound lead generation unless requested', () => {
    const result = ranker.rankRecommendations(
      {
        userId: 'user-id',
        clientProfile: {
          salesDirection: 'B2B',
          product: 'Бухгалтерские услуги',
          productStage: 'existing',
          leadGenerationTypes: ['inbound'],
          desiredResult: {
            description: 'Нужно фиксировать входящие заявки и переписки',
          },
          components: components({
            telephony: true,
            messenger: true,
            analytics: true,
          }),
        },
        persist: false,
      },
      [...services, service('contact-db', 'База контактов')],
      [
        {
          serviceId: 'contact-db',
          serviceName: 'База контактов',
          priority: RecommendationPriority.Urgent,
          rationale: 'fallback',
          diagnosticSignals: ['lead_generation_gap'],
          score: 100,
        },
      ],
      '',
      10,
    );

    expect(result.map((item) => item.serviceId)).not.toContain('contact-db');
  });

  it('boosts automation when canonical questionnaire asks for a voice robot', () => {
    const result = ranker.rankRecommendations(
      {
        userId: 'user-id',
        clientProfile: {
          productStage: 'existing',
          desiredResult: {
            period: '3m',
            description: 'Автоматизировать повторяющиеся действия отдела',
          },
          targetRevenue: 4000000,
          leadGenerationTypes: ['inbound'],
          components: components({
            voiceChatbot: true,
          }),
        },
        persist: false,
      },
      services,
      [],
      '',
      5,
    );

    expect(result.map((item) => item.serviceId)).toEqual(
      expect.arrayContaining(['automation']),
    );
  });

  it('keeps explicitly selected telephony, messenger and chatbot-related automation visible', () => {
    const result = ranker.rankRecommendations(
      {
        userId: 'user-id',
        clientProfile: {
          productStage: 'existing',
          desiredResult: {
            period: '1m',
            description:
              'отсутствует отдел продаж, нужно настроить отдел продаж',
          },
          targetRevenue: 500000,
          averageCheck: 1000000,
          conversionRate: 1,
          components: components({
            crm: true,
            telephony: true,
            messenger: true,
            voiceChatbot: true,
            salesManager: true,
            analytics: true,
          }),
        },
        persist: false,
      },
      services,
      [],
      '',
      12,
    );

    expect(result.map((item) => item.serviceId)).toEqual(
      expect.arrayContaining(['telephony', 'messenger', 'automation']),
    );
  });

  it('promotes generated recommendation priorities after questionnaire boosts', () => {
    const result = ranker.rankRecommendations(
      {
        userId: 'user-id',
        clientProfile: {
          productStage: 'Новый',
          targetResult: 'Построить отдел продаж с нуля',
        },
        persist: false,
      },
      services,
      [
        {
          serviceId: 'from-zero',
          serviceName: 'Отдел продаж с нуля',
          priority: RecommendationPriority.Urgent,
          rationale: 'llm',
          diagnosticSignals: ['ai_generated'],
          score: 100,
        },
        {
          serviceId: 'crm-start',
          serviceName: 'CRM Старт',
          priority: RecommendationPriority.Medium,
          rationale: 'llm',
          diagnosticSignals: ['ai_generated'],
          score: 95,
        },
      ],
      '',
      2,
    );

    expect(result.map((item) => item.priority)).toEqual([
      RecommendationPriority.Urgent,
      RecommendationPriority.Urgent,
    ]);
  });

  it('does not leave questionnaire-boosted recommendations as low priority', () => {
    const result = ranker.rankRecommendations(
      {
        userId: 'user-id',
        clientProfile: {
          productStage: 'existing',
          desiredResult: {
            period: '3m',
            description: 'Навести порядок в работе 2 менеджеров',
          },
          targetRevenue: 4000000,
          components: components({
            crm: true,
            telephony: true,
            messenger: true,
          }),
        },
        persist: false,
      },
      services,
      [],
      '',
      3,
    );

    expect(result.map((item) => item.serviceId)).toEqual(
      expect.arrayContaining(['crm-bronze', 'telephony']),
    );
    expect(result.map((item) => item.priority)).not.toContain(
      RecommendationPriority.Low,
    );
  });

  it('does not recommend basic sales department setup when sales already exist', () => {
    const result = ranker.rankRecommendations(
      {
        userId: 'user-id',
        clientProfile: {
          productStage: 'existing',
          desiredResult: {
            period: '3m',
            description: 'Навести порядок в работе 2 менеджеров',
          },
          targetRevenue: 4000000,
          components: components({
            crm: true,
            telephony: true,
            messenger: true,
            scripts: true,
          }),
        },
        persist: false,
      },
      services,
      [
        {
          serviceId: 'base-setup',
          serviceName: 'Базовая настройка работы отдела продаж',
          priority: RecommendationPriority.Urgent,
          rationale: 'llm',
          diagnosticSignals: ['ai_generated'],
          score: 100,
        },
      ],
      '',
      5,
    );

    expect(result.map((item) => item.serviceId)).not.toContain('base-setup');
  });

  it('treats the questionnaire value "Нет, продукт новый" as a new sales department', () => {
    const result = ranker.rankRecommendations(
      {
        userId: 'user-id',
        clientProfile: {
          productStage: 'Нет, продукт новый',
          targetResult: 'Увеличить продажи в команде из 6 менеджеров',
          calculatedManagersCount: 6,
          components: components({
            analytics: true,
            callAnalysis: true,
          }),
        },
        persist: false,
      },
      services,
      [],
      '',
      8,
    );

    expect(result.map((item) => item.serviceId)).toContain('dashboard');
    expect(result.map((item) => item.serviceId)).toContain('from-zero');
  });

  it('prioritizes requested tools and hiring for a new product with inbound leads', () => {
    const result = ranker.rankRecommendations(
      {
        userId: 'user-id',
        clientProfile: {
          productStage: 'Новый',
          leadGenerationType: 'Входящая',
          targetResult: 'Построить отдел продаж с нуля',
          desiredSalesDepartment: [
            'Телефония',
            'Мессенджер',
            'Менеджер по продажам',
          ],
        },
        persist: false,
      },
      services,
      [
        {
          serviceId: 'crm-audit',
          serviceName: 'Аудит CRM',
          priority: RecommendationPriority.Urgent,
          rationale: 'llm',
          diagnosticSignals: ['ai_generated'],
          score: 100,
        },
        {
          serviceId: 'crm-funnels',
          serviceName: 'Настройка воронок сделок (до 3 шт)',
          priority: RecommendationPriority.Urgent,
          rationale: 'llm',
          diagnosticSignals: ['ai_generated'],
          score: 100,
        },
        {
          serviceId: 'crm-tech-spec',
          serviceName: 'Подготовка технического задания',
          priority: RecommendationPriority.Urgent,
          rationale: 'llm',
          diagnosticSignals: ['ai_generated'],
          score: 100,
        },
        {
          serviceId: 'crm-report-setup',
          serviceName: 'Настройка отчёта',
          priority: RecommendationPriority.Urgent,
          rationale: 'llm',
          diagnosticSignals: ['ai_generated'],
          score: 100,
        },
        {
          serviceId: 'crm-deals-report',
          serviceName: 'Отчет по ведению сделок в CRM',
          priority: RecommendationPriority.Urgent,
          rationale: 'llm',
          diagnosticSignals: ['ai_generated'],
          score: 100,
        },
      ],
      '',
      5,
    );

    const serviceIds = result.map((item) => item.serviceId);

    expect(serviceIds).toEqual([
      'from-zero',
      'crm-start',
      'turnkey-hiring',
      'telephony',
      'messenger',
    ]);
    expect(serviceIds).not.toEqual(
      expect.arrayContaining([
        'crm-audit',
        'crm-funnels',
        'crm-tech-spec',
        'crm-report-setup',
        'crm-deals-report',
      ]),
    );
  });

  it('uses canonical questionnaire answers for a new product with inbound leads', () => {
    const result = ranker.rankRecommendations(
      {
        userId: 'user-id',
        clientProfile: {
          productStage: 'new',
          leadGenerationTypes: ['inbound'],
          desiredResult: {
            period: '6m',
            description: 'Построить отдел продаж с нуля',
          },
          targetRevenue: 5000000,
          components: components({
            telephony: true,
            messenger: true,
            salesManager: true,
          }),
        },
        persist: false,
      },
      services,
      [
        {
          serviceId: 'crm-audit',
          serviceName: 'Аудит CRM',
          priority: RecommendationPriority.Urgent,
          rationale: 'llm',
          diagnosticSignals: ['ai_generated'],
          score: 100,
        },
      ],
      '',
      5,
    );

    expect(result.map((item) => item.serviceId)).toEqual([
      'from-zero',
      'crm-start',
      'turnkey-hiring',
      'telephony',
      'messenger',
    ]);
  });

  it('treats explicit missing sales department text as a new department request', () => {
    const result = ranker.rankRecommendations(
      {
        userId: 'user-id',
        clientProfile: {
          productStage: 'existing',
          desiredResult: {
            period: '1m',
            description:
              'отсутствует отдел продаж, нужно настроить отдел продаж',
          },
          targetRevenue: 500000,
          averageCheck: 1000000,
          conversionRate: 1,
        },
        persist: false,
      },
      services,
      [],
      '',
      5,
    );

    expect(result.map((item) => item.serviceId)).toEqual(['from-zero']);
  });

  it('does not recommend three-month packages for a one-month goal', () => {
    const result = ranker.rankRecommendations(
      {
        userId: 'user-id',
        clientProfile: {
          productStage: 'existing',
          desiredResult: {
            period: '1m',
            description: 'Нужно быстро обучить менеджеров за месяц',
          },
          components: components({
            trainingSystem: true,
          }),
          targetRevenue: 4000000,
        },
        persist: false,
      },
      services,
      [
        {
          serviceId: 'training-3m',
          serviceName: 'Пакет обучения на 3 месяца',
          priority: RecommendationPriority.Urgent,
          rationale: 'llm',
          diagnosticSignals: ['ai_generated'],
          score: 100,
        },
        {
          serviceId: 'training-1m',
          serviceName: 'Пакет обучения на месяц',
          priority: RecommendationPriority.Medium,
          rationale: 'llm',
          diagnosticSignals: ['ai_generated'],
          score: 90,
        },
      ],
      '',
      5,
    );

    expect(result.map((item) => item.serviceId)).not.toContain('training-3m');
    expect(result.map((item) => item.serviceId)).toContain('training-1m');
  });

  it('does not cap questionnaire recommendations at five when no limit is provided', () => {
    const result = ranker.rankRecommendations(
      {
        userId: 'user-id',
        clientProfile: {
          productStage: 'new',
          leadGenerationTypes: ['inbound'],
          desiredResult: {
            period: '6m',
            description: 'Построить отдел продаж с нуля',
          },
          targetRevenue: 5000000,
          components: components({
            crm: true,
            telephony: true,
            messenger: true,
            salesManager: true,
            trainingSystem: true,
            analytics: true,
            scripts: true,
            salesDocuments: true,
            salesHead: true,
          }),
        },
        persist: false,
      },
      services,
      [],
      '',
    );

    expect(result.length).toBeGreaterThan(5);
    expect(result.map((item) => item.serviceId)).toEqual(
      expect.arrayContaining([
        'from-zero',
        'crm-start',
        'turnkey-hiring',
        'telephony',
        'messenger',
      ]),
    );
  });

  it('keeps a varied top list instead of filling it with one service group', () => {
    const result = ranker.rankRecommendations(
      {
        userId: 'user-id',
        clientProfile: {
          productStage: 'Уже продаю',
          targetResult: 'Нужны CRM, аналитика, телефония и контроль качества',
          desiredRevenue: 15000000,
          calculatedManagersCount: 8,
          desiredSalesDepartment: [
            'CRM',
            'Телефония',
            'Мессенджер',
            'Аналитика',
            'Анализ звонков',
            'РОП',
          ],
        },
        persist: false,
      },
      services,
      [],
      '',
      5,
    );

    const serviceIds = result.map((item) => item.serviceId);

    expect(serviceIds).toContain('dashboard');
    expect(serviceIds).not.toContain('quality');
    expect(
      serviceIds.filter((id) => id?.startsWith('crm')).length,
    ).toBeLessThanOrEqual(2);
  });

  it('treats canonical high-revenue questionnaire answers as mature department', () => {
    const result = ranker.rankRecommendations(
      {
        userId: 'user-id',
        clientProfile: {
          productStage: 'existing',
          desiredResult: {
            period: '6m',
            description: 'Масштабировать продажи и управлять отделом по данным',
          },
          targetRevenue: 15000000,
          leadGenerationTypes: ['inbound', 'outbound'],
          components: components({
            crm: true,
            telephony: true,
            messenger: true,
            analytics: true,
            callAnalysis: true,
            salesHead: true,
          }),
        },
        persist: false,
      },
      services,
      [],
      '',
      6,
    );

    const serviceIds = result.map((item) => item.serviceId);

    expect(serviceIds).toContain('dashboard');
    expect(serviceIds).not.toContain('quality');
    expect(serviceIds).not.toEqual(
      expect.arrayContaining(['from-zero', 'crm-start', 'crm-bronze']),
    );
  });

  it('infers mature department from canonical desired result manager count', () => {
    const result = ranker.rankRecommendations(
      {
        userId: 'user-id',
        clientProfile: {
          productStage: 'existing',
          desiredResult: {
            period: '3m',
            description: 'Масштабировать отдел продаж до 8 менеджеров',
          },
          targetRevenue: 4000000,
          leadGenerationTypes: ['outbound'],
          components: components({
            crm: true,
            analytics: true,
            scripts: true,
          }),
        },
        persist: false,
      },
      services,
      [],
      '',
      5,
    );

    const serviceIds = result.map((item) => item.serviceId);

    expect(serviceIds).toEqual(expect.arrayContaining(['dashboard']));
    expect(serviceIds).not.toEqual(
      expect.arrayContaining(['from-zero', 'crm-start', 'crm-bronze']),
    );
  });

  it('selects one-month training, CRM Start, AI analyses and ROP expert for the new-OP questionnaire', () => {
    const extendedServices = [
      ...services,
      service('ai-docs', 'ИИ анализ документов'),
      service('ai-crm', 'ИИ анализ CRM'),
      service('ai-calls', 'ИИ анализ звонков и менеджеров'),
      service('rop-expert', 'Эксперт РОП: консультация'),
    ];
    const result = ranker.rankRecommendations(
      {
        userId: 'user-id',
        clientProfile: {
          productStage: 'Нет, продукт новый',
          desiredResult: { period: '1 месяц', description: 'Запустить ОП' },
          components: components({
            crm: true,
            trainingSystem: true,
            salesDocuments: true,
            callAnalysis: true,
            salesHead: true,
          }),
        },
        persist: false,
      },
      extendedServices,
      [],
      '',
    );
    const names = result.map((item) => item.serviceName);
    expect(names).toEqual(expect.arrayContaining([
      'Пакет обучения на месяц',
      'CRM Старт',
      'ИИ анализ документов',
      'ИИ анализ CRM',
      'ИИ анализ звонков и менеджеров',
      'Эксперт РОП: консультация',
    ]));
    expect(names).not.toContain('Пакет обучения на 3 месяца');
  });

  it('runs the full new-OP scenario against stable catalog IDs', () => {
    const configuredCatalog = RECOMMENDATION_CATALOG_ENTRIES.map((entry) => ({
      ...service(entry.id, entry.displayName),
      serviceId: entry.kind === 'service' ? entry.id : null,
      packageId: entry.kind === 'package' ? entry.id : null,
    })) as ServiceCandidate[];
    const result = ranker.rankRecommendations(
      {
        userId: 'user-id',
        clientProfile: {
          productStage: 'new',
          desiredResult: { period: '1m', description: 'Запустить продажи' },
          components: components({
            crm: true,
            telephony: true,
            messenger: true,
            trainingSystem: true,
            analytics: true,
            scripts: true,
            callAnalysis: true,
            salesDocuments: true,
            salesHead: true,
          }),
        },
        persist: false,
      },
      configuredCatalog,
      [],
      '',
    );
    const targetIds = result.map((item) => item.packageId ?? item.serviceId);
    expect(targetIds).toEqual(expect.arrayContaining([
      RECOMMENDATION_CATALOG.salesDepartmentFromZero.id,
      RECOMMENDATION_CATALOG.crmStart.id,
      RECOMMENDATION_CATALOG.trainingOneMonth.id,
      RECOMMENDATION_CATALOG.aiCrmAnalysis.id,
      RECOMMENDATION_CATALOG.aiDashboardAnalysis.id,
      RECOMMENDATION_CATALOG.aiDocumentAnalysis.id,
      RECOMMENDATION_CATALOG.aiCallManagersAnalysis.id,
      RECOMMENDATION_CATALOG.salesHead.id,
    ]));
    expect(targetIds).not.toContain(RECOMMENDATION_CATALOG.trainingThreeMonths.id);
  });

  it('keeps AI document analysis and one-month training for an existing outbound split flow by catalog ID', () => {
    const configuredCatalog = RECOMMENDATION_CATALOG_ENTRIES.map((entry) => ({
      ...service(
        entry.id,
        entry.id === RECOMMENDATION_CATALOG.trainingThreeMonths.id
          ? 'Переименованный пакет обучения'
          : entry.displayName,
      ),
      serviceId: entry.kind === 'service' ? entry.id : null,
      packageId: entry.kind === 'package' ? entry.id : null,
    })) as ServiceCandidate[];
    const result = ranker.rankRecommendations(
      {
        userId: 'user-id',
        clientProfile: {
          productStage: 'existing',
          leadGenerationTypes: ['outbound'],
          desiredResult: {
            period: '1m',
            description: 'Усилить существующий отдел продаж',
          },
          components: components({
            crm: true,
            contactDatabase: true,
            salesManager: true,
            scripts: true,
          }),
          componentsToAdd: components({
            crm: true,
            telephony: true,
            messenger: true,
            salesManager: true,
            trainingSystem: true,
            salesDocuments: true,
            salesHead: true,
          }),
        },
        persist: false,
      },
      configuredCatalog,
      [
        {
          serviceId: null,
          packageId: RECOMMENDATION_CATALOG.trainingThreeMonths.id,
          serviceName: 'Переименованный пакет обучения',
          priority: RecommendationPriority.Urgent,
          rationale: 'llm',
          diagnosticSignals: ['ai_generated'],
          score: 100,
        },
      ],
      '',
    );

    const targetIds = result.map((item) => item.packageId ?? item.serviceId);

    expect(targetIds).toContain(RECOMMENDATION_CATALOG.aiDocumentAnalysis.id);
    expect(targetIds).toContain(RECOMMENDATION_CATALOG.trainingOneMonth.id);
    expect(targetIds).not.toContain(
      RECOMMENDATION_CATALOG.trainingThreeMonths.id,
    );
  });

  it('substitutes one-month training inside an ideal reference', () => {
    const result = ranker.rankRecommendations(
      {
        userId: 'user-id',
        clientProfile: {
          productStage: 'existing',
          leadGenerationTypes: ['inbound'],
          desiredResult: { period: '1m' },
          components: components({
            telephony: true,
            messenger: true,
            trainingSystem: true,
            analytics: true,
            salesHead: true,
          }),
        },
        persist: false,
      },
      services,
      [],
      '',
    );

    const serviceIds = result.map((item) => item.serviceId);

    expect(serviceIds).toContain('training-1m');
    expect(serviceIds).not.toContain('training-3m');
  });

});
