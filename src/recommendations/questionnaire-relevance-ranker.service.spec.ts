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
    }) as ServiceCandidate;

  const services = [
    service('from-zero', 'Отдел продаж с нуля'),
    service('base-setup', 'Базовая настройка работы отдела продаж'),
    service('docs-package', 'Пакет документов отдела продаж'),
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
    service(
      'calls-report',
      'Отчёт с оценкой прослушанных разговоров с клиентами',
    ),
    service('dashboard', 'Дашборд ОП'),
    service('ai-rop', 'ИИ РОП'),
    service('quality', 'На Контроле + Рубичат'),
    service('sales-head', 'Руководитель отдела продаж'),
    service('financial-director', 'Финансовый директор'),
  ];

  const scoringService = {
    scoreService: (candidate: ServiceCandidate): GeneratedRecommendationItem => ({
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
          desiredSalesDepartment: [
            'CRM',
            'Телефония',
            'Мессенджер',
            'Скрипты',
          ],
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

  it('keeps visible priority distribution independent from raw relevance score', () => {
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
      [],
      '',
      5,
    );

    expect(result.map((item) => item.priority)).toEqual([
      RecommendationPriority.Urgent,
      RecommendationPriority.Medium,
      RecommendationPriority.Medium,
      RecommendationPriority.Low,
      RecommendationPriority.Low,
    ]);
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

  it('keeps a varied top list instead of filling it with one service group', () => {
    const result = ranker.rankRecommendations(
      {
        userId: 'user-id',
        clientProfile: {
          productStage: 'Уже продаю',
          targetResult:
            'Нужны CRM, аналитика, телефония и контроль качества',
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

    expect(serviceIds).toEqual(expect.arrayContaining(['dashboard', 'quality']));
    expect(serviceIds.filter((id) => id.startsWith('crm')).length).toBeLessThanOrEqual(2);
  });
});
