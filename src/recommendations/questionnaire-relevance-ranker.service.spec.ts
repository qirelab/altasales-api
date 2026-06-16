import { ServiceType } from '../services/entities/service-type.enum';
import { RecommendationPriority } from './entities/recommendation-priority.enum';
import { QuestionnaireRelevanceRankerService } from './questionnaire-relevance-ranker.service';
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
    chatbot: false,
    voiceRobot: false,
    contactDatabase: false,
    salesManager: false,
    trainingSystem: false,
    analytics: false,
    scripts: false,
    callAnalysis: false,
    businessTrainer: false,
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
      'dashboard',
      'crm-start',
      'crm-audit',
    ]);
    expect(result[0].diagnosticSignals).toContain(
      'ideal_reference:new_b2b_outbound_full_sales_department',
    );
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
      'dashboard',
      'crm-audit',
      'ai-rop',
      'document-request',
      'sales-head',
    ]);
    expect(result[0].diagnosticSignals).toContain(
      'ideal_reference:existing_b2b_inbound_managed_sales_department',
    );
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
            voiceRobot: true,
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
            chatbot: true,
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
      expect.arrayContaining(['crm-bronze', 'telephony', 'messenger']),
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

  it('does not treat a new product alone as a new sales department', () => {
    const result = ranker.rankRecommendations(
      {
        userId: 'user-id',
        clientProfile: {
          productStage: 'Новый',
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
    expect(result.map((item) => item.serviceId)).not.toEqual(
      expect.arrayContaining(['from-zero']),
    );
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

    expect(result.map((item) => item.serviceId)).toEqual([
      'from-zero',
      'crm-start',
      'turnkey-hiring',
      'telephony',
      'messenger',
    ]);
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
            telephony: true,
            messenger: true,
            salesManager: true,
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

    expect(serviceIds).toEqual(
      expect.arrayContaining(['dashboard', 'quality']),
    );
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

    expect(serviceIds).toEqual(
      expect.arrayContaining(['dashboard', 'quality']),
    );
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
});
