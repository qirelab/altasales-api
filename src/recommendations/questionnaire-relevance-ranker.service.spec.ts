import { ServiceType } from '../services/entities/service-type.enum';
import { RecommendationPriority } from './entities/recommendation-priority.enum';
import { QuestionnaireRelevanceRankerService } from './questionnaire-relevance-ranker.service';
import {
  GeneratedRecommendationItem,
  RecommendationTargetCandidate,
} from './recommendation-scoring.service';

describe('QuestionnaireRelevanceRankerService', () => {
  const service = (id: string, name: string): RecommendationTargetCandidate =>
    ({
      id,
      serviceId: id,
      packageId: null,
      targetType: 'service',
      name,
      description: name,
      type: ServiceType.Service,
      price: 0,
      skills: [],
      tags: [],
      services: [],
      category: null,
    }) as RecommendationTargetCandidate;

  const servicePackage = (
    id: string,
    name: string,
    tags: string[],
  ): RecommendationTargetCandidate =>
    ({
      id,
      serviceId: null,
      packageId: id,
      targetType: 'package',
      name,
      description: name,
      price: 0,
      skills: [],
      tags,
      packageType: 'Silver',
      services: [],
      category: 'Package',
    }) as RecommendationTargetCandidate;

  const services = [
    service('from-zero', 'Отдел продаж с нуля'),
    service('base-setup', 'Базовая настройка работы отдела продаж'),
    service('crm-start', 'CRM Старт'),
    service('crm-bronze', 'CRM Бронза'),
    service('crm-silver', 'CRM Серебро'),
    service('crm-gold', 'CRM Золото'),
    service('sales-script', 'Скрипт продаж'),
    service('turnkey-hiring', 'Подбор под ключ'),
    service('telephony', 'Интеграция телефонии'),
    service('messenger', 'Интеграция мессенджера'),
    service('calls-report', 'Отчёт с оценкой прослушанных разговоров с клиентами'),
    service('dashboard', 'Дашборд ОП'),
    servicePackage('crm-silver-package', 'CRM Серебро пакет', [
      'CRM',
      'Серебро',
      'Аналитика',
    ]),
    service('ai-rop', 'ИИ РОП'),
    service('quality', 'На Контроле + Рубичат'),
    service('sales-head', 'Руководитель отдела продаж'),
    service('financial-director', 'Финансовый директор'),
  ];

  const scoringService = {
    scoreCandidate: (
      candidate: RecommendationTargetCandidate,
    ): GeneratedRecommendationItem => ({
      serviceId: candidate.serviceId,
      packageId: candidate.packageId,
      serviceName: candidate.name,
      targetType: candidate.targetType,
      priority: RecommendationPriority.Low,
      rationale: 'fallback',
      diagnosticSignals: [],
      score: 0,
    }),
    getCandidateKey: (candidate: RecommendationTargetCandidate): string =>
      candidate.packageId
        ? `package:${candidate.packageId}`
        : `service:${candidate.serviceId}`,
    getRecommendationKey: (item: GeneratedRecommendationItem): string =>
      item.packageId ? `package:${item.packageId}` : `service:${item.serviceId}`,
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

    expect(serviceIds).toEqual(expect.arrayContaining(['dashboard', 'quality']));
    expect(
      serviceIds.filter((id): id is string => Boolean(id)).filter((id) => id.startsWith('crm')).length,
    ).toBeLessThanOrEqual(2);
  });

  it('can recommend packages using package tags and package type', () => {
    const result = ranker.rankRecommendations(
      {
        userId: 'user-id',
        clientProfile: {
          productStage: 'Уже продаю',
          desiredRevenue: 15000000,
          calculatedManagersCount: 8,
          desiredSalesDepartment: ['CRM', 'Аналитика'],
        },
        persist: false,
      },
      services,
      [],
      '',
      5,
    );

    expect(result.map((item) => item.packageId)).toContain('crm-silver-package');
  });
});
