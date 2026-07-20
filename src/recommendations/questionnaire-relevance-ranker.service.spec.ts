import { ServiceType } from '../services/entities/service-type.enum';
import { RecommendationPriority } from './entities/recommendation-priority.enum';
import { QuestionnaireRelevanceRankerService } from './questionnaire-relevance-ranker.service';
import {
  RECOMMENDATION_CATALOG,
  RECOMMENDATION_CATALOG_ENTRIES,
  RecommendationCatalogKey,
} from './recommendation-catalog.registry';
import {
  GeneratedRecommendationItem,
  RecommendationScoringService,
  ServiceCandidate,
} from './recommendation-scoring.service';
import { selectNonOverlappingRecommendations } from './recommendation-coverage.util';

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
    service('from-zero', 'РћС‚РґРµР» РїСЂРѕРґР°Р¶ СЃ РЅСѓР»СЏ'),
    service('base-setup', 'Р‘Р°Р·РѕРІР°СЏ РЅР°СЃС‚СЂРѕР№РєР° СЂР°Р±РѕС‚С‹ РѕС‚РґРµР»Р° РїСЂРѕРґР°Р¶'),
    service('docs-package', 'РџР°РєРµС‚ РґРѕРєСѓРјРµРЅС‚РѕРІ РѕС‚РґРµР»Р° РїСЂРѕРґР°Р¶'),
    service('training-3m', 'РџР°РєРµС‚ РѕР±СѓС‡РµРЅРёСЏ РЅР° 3 РјРµСЃСЏС†Р°'),
    service('training-1m', 'РџР°РєРµС‚ РѕР±СѓС‡РµРЅРёСЏ РЅР° РјРµСЃСЏС†'),
    service('crm-start', 'CRM РЎС‚Р°СЂС‚'),
    service('crm-bronze', 'CRM Р‘СЂРѕРЅР·Р°'),
    service('crm-silver', 'CRM РЎРµСЂРµР±СЂРѕ'),
    service('crm-gold', 'CRM Р—РѕР»РѕС‚Рѕ'),
    service('crm-audit', 'РђСѓРґРёС‚ CRM'),
    service('crm-funnels', 'РќР°СЃС‚СЂРѕР№РєР° РІРѕСЂРѕРЅРѕРє СЃРґРµР»РѕРє (РґРѕ 3 С€С‚)'),
    service('crm-tech-spec', 'РџРѕРґРіРѕС‚РѕРІРєР° С‚РµС…РЅРёС‡РµСЃРєРѕРіРѕ Р·Р°РґР°РЅРёСЏ'),
    service('crm-report-setup', 'РќР°СЃС‚СЂРѕР№РєР° РѕС‚С‡С‘С‚Р°'),
    service('crm-deals-report', 'РћС‚С‡РµС‚ РїРѕ РІРµРґРµРЅРёСЋ СЃРґРµР»РѕРє РІ CRM'),
    service('sales-script', 'РЎРєСЂРёРїС‚ РїСЂРѕРґР°Р¶'),
    service('turnkey-hiring', 'РџРѕРґР±РѕСЂ РїРѕРґ РєР»СЋС‡'),
    service('telephony', 'РРЅС‚РµРіСЂР°С†РёСЏ С‚РµР»РµС„РѕРЅРёРё'),
    service('messenger', 'РРЅС‚РµРіСЂР°С†РёСЏ РјРµСЃСЃРµРЅРґР¶РµСЂР°'),
    service('automation', 'РќР°СЃС‚СЂРѕР№РєР° СЂРѕР±РѕС‚РѕРІ РґР»СЏ Р°РІС‚РѕРјР°С‚РёР·Р°С†РёРё'),
    service(
      'calls-report',
      'РћС‚С‡С‘С‚ СЃ РѕС†РµРЅРєРѕР№ РїСЂРѕСЃР»СѓС€Р°РЅРЅС‹С… СЂР°Р·РіРѕРІРѕСЂРѕРІ СЃ РєР»РёРµРЅС‚Р°РјРё',
    ),
    service(
      'messenger-report',
      'РћС‚С‡С‘С‚ СЃ РѕС†РµРЅРєРѕР№ РїСЂРѕР°РЅР°Р»РёР·РёСЂРѕРІР°РЅРЅС‹С… РїРµСЂРµРїРёСЃРѕРє СЃ РєР»РёРµРЅС‚Р°РјРё',
    ),
    service('dashboard', 'Р”Р°С€Р±РѕСЂРґ РћРџ'),
    service('ai-rop', 'РР Р РћРџ'),
    service('quality', 'РќР° РљРѕРЅС‚СЂРѕР»Рµ + Р СѓР±РёС‡Р°С‚'),
    service('sales-head', 'Р СѓРєРѕРІРѕРґРёС‚РµР»СЊ РѕС‚РґРµР»Р° РїСЂРѕРґР°Р¶'),
    service('document-request', 'Р”РѕРєСѓРјРµРЅС‚ РїРѕРґ Р·Р°РїСЂРѕСЃ'),
    service('financial-director', 'Р¤РёРЅР°РЅСЃРѕРІС‹Р№ РґРёСЂРµРєС‚РѕСЂ'),
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

  const configuredCatalogWithCrmStartCoverage = (): ServiceCandidate[] =>
    RECOMMENDATION_CATALOG_ENTRIES.map(
      (entry) =>
        ({
          ...service(entry.id, entry.displayName),
          serviceId: entry.kind === 'service' ? entry.id : null,
          packageId: entry.kind === 'package' ? entry.id : null,
          coveredServiceIds:
            entry.id === RECOMMENDATION_CATALOG.crmStart.id
              ? [
                RECOMMENDATION_CATALOG.telephonyIntegration.id,
                RECOMMENDATION_CATALOG.messengerIntegration.id,
              ]
              : undefined,
        }) as ServiceCandidate,
    );

  const scoringService = {
    scoreService: (
      candidate: ServiceCandidate,
    ): GeneratedRecommendationItem => ({
      serviceId: candidate.packageId
        ? null
        : (candidate.serviceId ?? candidate.id),
      packageId: candidate.packageId ?? null,
      serviceName: candidate.name,
      priority: RecommendationPriority.Low,
      rationale: 'fallback',
      diagnosticSignals: [],
      score: 0,
      coveredServiceIds: candidate.coveredServiceIds,
      coverageKeys: candidate.coverageKeys ?? candidate.coveredServiceIds,
    }),
    normalizeSignals: (signals: string[]): string[] =>
      Array.from(new Set(signals.filter(Boolean))),
  };

  let ranker: QuestionnaireRelevanceRankerService;

  type RankerTestApi = {
    validateConfiguredCatalog(services: ServiceCandidate[]): boolean;
    findCandidateByCatalogKey(
      services: ServiceCandidate[],
      catalogKey: RecommendationCatalogKey,
      usedTargetIds: Set<string>,
      additionalAliases?: string[],
    ): ServiceCandidate | null;
  };

  const getRankerTestApi = (
    instance: QuestionnaireRelevanceRankerService,
  ): RankerTestApi => instance as unknown as RankerTestApi;

  beforeEach(() => {
    ranker = new QuestionnaireRelevanceRankerService(
      scoringService as unknown as RecommendationScoringService,
    );
  });

  it('resolves configured catalog items by stable ID after a display name change', () => {
    const configuredServices = RECOMMENDATION_CATALOG_ENTRIES.map(
      (entry) =>
        ({
          ...service(entry.id, `РџРµСЂРµРёРјРµРЅРѕРІР°РЅРЅР°СЏ РїРѕР·РёС†РёСЏ ${entry.id}`),
          serviceId: entry.kind === 'service' ? entry.id : null,
          packageId: entry.kind === 'package' ? entry.id : null,
        }) as ServiceCandidate,
    );

    const result = ranker.rankRecommendations(
      {
        userId: 'user-id',
        clientProfile: {
          productStage: 'new',
          desiredResult: { description: 'РћС‚РґРµР»Р° РїСЂРѕРґР°Р¶ РЅРµС‚, Р·Р°РїСѓСЃРєР°РµРј СЃ РЅСѓР»СЏ' },
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

  it('fails fast when a configured catalog item is missing by ID and name', () => {
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
    ).toThrow(`Recommendation catalog item is missing: РђСѓРґРёС‚ CRM`);
  });

  it('accepts a legacy catalog UUID when the configured name and kind match', () => {
    const configuredServices = RECOMMENDATION_CATALOG_ENTRIES.map((entry) => {
      const targetId =
        entry.id === RECOMMENDATION_CATALOG.salesDepartmentFromZero.id
          ? 'legacy-sales-department-id'
          : entry.id;
      return {
        ...service(targetId, entry.displayName),
        serviceId: entry.kind === 'service' ? targetId : null,
        packageId: entry.kind === 'package' ? targetId : null,
      } as ServiceCandidate;
    });

    expect(
      getRankerTestApi(ranker).validateConfiguredCatalog(configuredServices),
    ).toBe(false);
  });
  it('prefers an exact catalog alias over an earlier description match', () => {
    const unrelatedService = {
      ...service('unrelated-service-id', 'РќРµСЃРІСЏР·Р°РЅРЅР°СЏ РєРѕРЅСЃСѓР»СЊС‚Р°С†РёСЏ'),
      description: 'РџР°РєРµС‚ РћРџ СЃ РЅСѓР»СЏ',
      serviceId: 'unrelated-service-id',
      packageId: null,
    } as ServiceCandidate;
    const legacyPackage = {
      ...service('legacy-package-id', 'РћС‚РґРµР» РїСЂРѕРґР°Р¶ СЃ РЅСѓР»СЏ'),
      serviceId: null,
      packageId: 'legacy-package-id',
    } as ServiceCandidate;

    const result = getRankerTestApi(ranker).findCandidateByCatalogKey(
      [unrelatedService, legacyPackage],
      'salesDepartmentFromZero',
      new Set<string>(),
      ['РџР°РєРµС‚ РћРџ СЃ РЅСѓР»СЏ'],
    );

    expect(result).toBe(legacyPackage);
  });
  it('preserves alias priority when catalog candidates are reversed', () => {
    const outsourcedSalesHead = {
      ...service('outsourced-sales-head-id', 'Р РћРџ РЅР° Р°СѓС‚СЃРѕСЂСЃРёРЅРіРµ'),
      serviceId: 'outsourced-sales-head-id',
      packageId: null,
    } as ServiceCandidate;
    const canonicalSalesHead = {
      ...service('sales-head-id', 'Р СѓРєРѕРІРѕРґРёС‚РµР»СЊ РѕС‚РґРµР»Р° РїСЂРѕРґР°Р¶'),
      serviceId: 'sales-head-id',
      packageId: null,
    } as ServiceCandidate;

    const result = getRankerTestApi(ranker).findCandidateByCatalogKey(
      [outsourcedSalesHead, canonicalSalesHead],
      'salesHead',
      new Set<string>(),
      ['Р СѓРєРѕРІРѕРґРёС‚РµР»СЊ РѕС‚РґРµР»Р° РїСЂРѕРґР°Р¶', 'Р РћРџ РЅР° Р°СѓС‚СЃРѕСЂСЃРёРЅРіРµ'],
    );

    expect(result).toBe(canonicalSalesHead);
  });
  it('does not accept a legacy catalog UUID from description or category text', () => {
    const missingEntry = RECOMMENDATION_CATALOG.salesDepartmentFromZero;
    const configuredServices = RECOMMENDATION_CATALOG_ENTRIES.filter(
      (entry) => entry.id !== missingEntry.id,
    ).map((entry) => {
      const targetId = entry.id;
      return {
        ...service(targetId, entry.displayName),
        serviceId: entry.kind === 'service' ? targetId : null,
        packageId: entry.kind === 'package' ? targetId : null,
      } as ServiceCandidate;
    });
    configuredServices.push({
      ...service('unrelated-service-id', 'РќРµСЃРІСЏР·Р°РЅРЅР°СЏ СѓСЃР»СѓРіР°'),
      description: missingEntry.displayName,
      category: { name: missingEntry.displayName },
    } as ServiceCandidate);

    expect(() =>
      getRankerTestApi(ranker).validateConfiguredCatalog(configuredServices),
    ).toThrow(
      `Recommendation catalog item is missing: ${missingEntry.displayName}`,
    );
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
          productStage: 'РЈР¶Рµ РїСЂРѕРґР°СЋ',
          targetResult: 'РњР°СЃС€С‚Р°Р±РёСЂРѕРІР°С‚СЊ РѕС‚РґРµР» РїСЂРѕРґР°Р¶ СЃ 8 РјРµРЅРµРґР¶РµСЂР°РјРё',
          desiredRevenue: 15000000,
          calculatedManagersCount: 8,
          desiredSalesDepartment: ['CRM', 'РђРЅР°Р»РёС‚РёРєР°', 'Р РћРџ'],
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
          productStage: 'РЈР¶Рµ РїСЂРѕРґР°СЋ',
          targetResult: 'РќР°РІРµСЃС‚Рё РїРѕСЂСЏРґРѕРє РІ СЂР°Р±РѕС‚Рµ 2 РјРµРЅРµРґР¶РµСЂРѕРІ',
          desiredRevenue: 4000000,
          calculatedManagersCount: 2,
          leadGenerationType: 'Р’С…РѕРґСЏС‰Р°СЏ',
          desiredSalesDepartment: ['CRM', 'РўРµР»РµС„РѕРЅРёСЏ', 'РњРµСЃСЃРµРЅРґР¶РµСЂ', 'РЎРєСЂРёРїС‚С‹'],
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
            description: 'РќР°РІРµСЃС‚Рё РїРѕСЂСЏРґРѕРє РІ СЂР°Р±РѕС‚Рµ 2 РјРµРЅРµРґР¶РµСЂРѕРІ',
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
            description: 'РЈСЃРёР»РёС‚СЊ РґРµР№СЃС‚РІСѓСЋС‰РёР№ РѕС‚РґРµР» РїСЂРѕРґР°Р¶',
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
          serviceName: 'CRM РЎС‚Р°СЂС‚',
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
            description: 'РџСЂРѕРІРµСЂРёС‚СЊ РєР°С‡РµСЃС‚РІРѕ РІРµРґРµРЅРёСЏ СЃРґРµР»РѕРє РІ CRM',
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
              'РҐРѕС‡Сѓ СѓСЃРёР»РёС‚СЊ Р РћРџР° Рё РІРёРґРµС‚СЊ Р°РЅР°Р»РёС‚РёРєСѓ РїРѕ С‚РµРєСѓС‰РµРјСѓ РѕС‚РґРµР»Сѓ РїСЂРѕРґР°Р¶',
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
            description: 'РҐРѕС‡Сѓ РїРѕРЅСЏС‚СЊ, С‡С‚Рѕ РјРѕР¶РЅРѕ СѓР»СѓС‡С€РёС‚СЊ РІ РѕС‚РґРµР»Рµ РїСЂРѕРґР°Р¶',
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
          serviceName: 'CRM РЎС‚Р°СЂС‚',
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
            description: 'РћС‚РґРµР»Р° РїСЂРѕРґР°Р¶ РЅРµС‚, РЅСѓР¶РЅРѕ РїРѕСЃС‚СЂРѕРёС‚СЊ РµРіРѕ СЃ РЅСѓР»СЏ',
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
          product: 'РЎС‚СЂРѕРёС‚РµР»СЊРЅС‹Рµ РјР°С‚РµСЂРёР°Р»С‹',
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
      'crm-deals-report',
      'crm-start',
      'turnkey-hiring',
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
          product: 'РЎС‚СЂРѕРёС‚РµР»СЊРЅС‹Рµ РјР°С‚РµСЂРёР°Р»С‹',
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
      'crm-deals-report',
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
          product: 'РЎС‚СЂРѕРёС‚РµР»СЊРЅС‹Рµ РјР°С‚РµСЂРёР°Р»С‹',
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
        'РР Р°РЅР°Р»РёР· CRM',
        'РР Р°РЅР°Р»РёР· РґР°С€Р±РѕСЂРґР°',
        'РР Р°РЅР°Р»РёР· РґРѕРєСѓРјРµРЅС‚РѕРІ',
      ]),
    );
  });

  it('does not keep external AI-analysis labels in catalog aliases', () => {
    const aliases = RECOMMENDATION_CATALOG_ENTRIES.flatMap(
      (entry) => entry.legacyAliases,
    ).join(' ');

    expect(aliases).not.toContain('РёРё Р°РЅР°Р»РёР· crm');
    expect(aliases).not.toContain('РёРё Р°РЅР°Р»РёР· РґР°С€Р±РѕСЂРґР°');
    expect(aliases).not.toContain('РёРё Р°РЅР°Р»РёР· РґРѕРєСѓРјРµРЅС‚РѕРІ');
  });

  it('replaces the legacy quality-control recommendation with AI call analysis', () => {
    const aiAnalysisServices = [
      service('ai-calls', 'РР Р°РЅР°Р»РёР· Р·РІРѕРЅРєРѕРІ Рё РјРµРЅРµРґР¶РµСЂРѕРІ'),
      service(
        'calls-report',
        'РћС‚С‡С‘С‚ СЃ РѕС†РµРЅРєРѕР№ РїСЂРѕСЃР»СѓС€Р°РЅРЅС‹С… СЂР°Р·РіРѕРІРѕСЂРѕРІ СЃ РєР»РёРµРЅС‚Р°РјРё',
      ),
      service('quality', 'РќР° РљРѕРЅС‚СЂРѕР»Рµ + Р СѓР±РёС‡Р°С‚'),
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
      service('office', 'РћС„РёСЃ'),
      service('office-pro', 'РћС„РёСЃ PRO'),
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
          serviceName: 'РћС„РёСЃ',
          priority: RecommendationPriority.Low,
          rationale: 'weak replacement',
          diagnosticSignals: [],
          score: -100,
        },
        {
          serviceId: 'office-pro',
          serviceName: 'РћС„РёСЃ PRO',
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
    ['crm', 'РР Р°РЅР°Р»РёР· CRM'],
    ['salesDocuments', 'РР Р°РЅР°Р»РёР· РґРѕРєСѓРјРµРЅС‚РѕРІ'],
    ['telephony', 'РР Р°РЅР°Р»РёР· Р·РІРѕРЅРєРѕРІ Рё РјРµРЅРµРґР¶РµСЂРѕРІ'],
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
          service('ai-crm', 'РР Р°РЅР°Р»РёР· CRM'),
          service('ai-dashboard', 'РР Р°РЅР°Р»РёР· РґР°С€Р±РѕСЂРґР°'),
          service('ai-documents', 'РР Р°РЅР°Р»РёР· РґРѕРєСѓРјРµРЅС‚РѕРІ'),
          service('ai-calls', 'РР Р°РЅР°Р»РёР· Р·РІРѕРЅРєРѕРІ Рё РјРµРЅРµРґР¶РµСЂРѕРІ'),
        ],
        [],
        '',
      );

      expect(result.map((item) => item.serviceName)).toContain(
        expectedServiceName,
      );
    },
  );

  it('does not recommend the disabled dashboard AI analysis service', () => {
    const result = ranker.rankRecommendations(
      {
        userId: 'user-id',
        clientProfile: {
          productStage: 'existing',
          components: components({ analytics: true }),
          componentsToAdd: components(),
        },
        persist: false,
      },
      [service('ai-dashboard', 'РР Р°РЅР°Р»РёР· РґР°С€Р±РѕСЂРґР°')],
      [
        {
          serviceId: 'ai-dashboard',
          serviceName: 'РР Р°РЅР°Р»РёР· РґР°С€Р±РѕСЂРґР°',
          priority: RecommendationPriority.Urgent,
          rationale: 'llm',
          diagnosticSignals: ['ai_generated'],
          score: 100,
        },
      ],
      '',
    );

    expect(result).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ serviceName: 'РР Р°РЅР°Р»РёР· РґР°С€Р±РѕСЂРґР°' }),
      ]),
    );
  });

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
        service('ai-calls', 'РР Р°РЅР°Р»РёР· Р·РІРѕРЅРєРѕРІ Рё РјРµРЅРµРґР¶РµСЂРѕРІ'),
        service('telephony', 'РРЅС‚РµРіСЂР°С†РёСЏ С‚РµР»РµС„РѕРЅРёРё'),
        service('messenger', 'РРЅС‚РµРіСЂР°С†РёСЏ РјРµСЃСЃРµРЅРґР¶РµСЂР°'),
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
        service('office', 'РћС„РёСЃ'),
        service('office-pro', 'РћС„РёСЃ PRO'),
        service('online', 'РЎС‚Р°РЅРґР°СЂС‚ Online'),
      ],
      [],
      '',
    );

    expect(result.map((item) => item.serviceId)).toEqual(['office']);
  });

  it('fills the limit after collapsing alternative hiring formats', () => {
    const candidates = [
      service('office', 'РћС„РёСЃ'),
      service('office-pro', 'РћС„РёСЃ PRO'),
      service('service-1', 'РЈСЃР»СѓРіР° 1'),
      service('service-2', 'РЈСЃР»СѓРіР° 2'),
      service('service-3', 'РЈСЃР»СѓРіР° 3'),
      service('service-4', 'РЈСЃР»СѓРіР° 4'),
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
          desiredResult: { description: 'РЈСЃРёР»РёС‚СЊ РїСЂРѕРґР°Р¶Рё' },
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
    } as unknown as RecommendationScoringService);

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
      [service('report-setup', 'РќР°СЃС‚СЂРѕР№РєР° РѕС‚С‡С‘С‚Р°')],
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
          product: 'РЎС‚СЂРѕРёС‚РµР»СЊРЅС‹Рµ РјР°С‚РµСЂРёР°Р»С‹',
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
      [service('exact-from-zero', 'РџР°РєРµС‚ РћРџ СЃ РЅСѓР»СЏ'), ...services],
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
          product: 'РЎС‚СЂРѕРёС‚РµР»СЊРЅС‹Рµ РјР°С‚РµСЂРёР°Р»С‹',
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
      'РРЅРґРёРІРёРґСѓР°Р»СЊРЅС‹Р№ Р°СѓРґРёС‚ СЂРѕСЃС‚Р° РїСЂРѕРґР°Р¶',
    );
    const result = ranker.rankRecommendations(
      {
        userId: 'user-id',
        clientProfile: {
          salesDirection: 'B2B',
          product: 'РЎС‚СЂРѕРёС‚РµР»СЊРЅС‹Рµ РјР°С‚РµСЂРёР°Р»С‹',
          productStage: 'new',
          leadGenerationTypes: ['outbound'],
          desiredResult: {
            description: 'Р”РѕРїРѕР»РЅРёС‚РµР»СЊРЅРѕ РЅСѓР¶РµРЅ Р°СѓРґРёС‚ СЂРѕСЃС‚Р° РїСЂРѕРґР°Р¶',
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
          serviceName: 'РРЅРґРёРІРёРґСѓР°Р»СЊРЅС‹Р№ Р°СѓРґРёС‚ СЂРѕСЃС‚Р° РїСЂРѕРґР°Р¶',
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

  it('keeps the full requested set while applying the new-OP golden scenario', () => {
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
    expect(result.flatMap((item) => item.diagnosticSignals)).toContain(
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
          desiredResult: { description: 'РЈСЃРёР»РёС‚СЊ РїСЂРѕРґР°Р¶Рё' },
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
          serviceName: 'РР Р РћРџ',
          priority: RecommendationPriority.Urgent,
          rationale: 'llm',
          diagnosticSignals: ['ai_generated'],
          score: 100,
        },
        {
          serviceId: 'sales-head',
          serviceName: 'Р СѓРєРѕРІРѕРґРёС‚РµР»СЊ РѕС‚РґРµР»Р° РїСЂРѕРґР°Р¶',
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
          product: 'Р‘СѓС…РіР°Р»С‚РµСЂСЃРєРёРµ СѓСЃР»СѓРіРё',
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
          product: 'Р‘СѓС…РіР°Р»С‚РµСЂСЃРєРёРµ СѓСЃР»СѓРіРё',
          productStage: 'existing',
          leadGenerationTypes: ['inbound'],
          desiredResult: {
            description: 'РќСѓР¶РЅРѕ С„РёРєСЃРёСЂРѕРІР°С‚СЊ РІС…РѕРґСЏС‰РёРµ Р·Р°СЏРІРєРё Рё РїРµСЂРµРїРёСЃРєРё',
          },
          components: components({
            telephony: true,
            messenger: true,
            analytics: true,
          }),
        },
        persist: false,
      },
      [...services, service('contact-db', 'Р‘Р°Р·Р° РєРѕРЅС‚Р°РєС‚РѕРІ')],
      [
        {
          serviceId: 'contact-db',
          serviceName: 'Р‘Р°Р·Р° РєРѕРЅС‚Р°РєС‚РѕРІ',
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
            description: 'РђРІС‚РѕРјР°С‚РёР·РёСЂРѕРІР°С‚СЊ РїРѕРІС‚РѕСЂСЏСЋС‰РёРµСЃСЏ РґРµР№СЃС‚РІРёСЏ РѕС‚РґРµР»Р°',
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
              'РѕС‚СЃСѓС‚СЃС‚РІСѓРµС‚ РѕС‚РґРµР» РїСЂРѕРґР°Р¶, РЅСѓР¶РЅРѕ РЅР°СЃС‚СЂРѕРёС‚СЊ РѕС‚РґРµР» РїСЂРѕРґР°Р¶',
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
          productStage: 'РќРѕРІС‹Р№',
          targetResult: 'РџРѕСЃС‚СЂРѕРёС‚СЊ РѕС‚РґРµР» РїСЂРѕРґР°Р¶ СЃ РЅСѓР»СЏ',
        },
        persist: false,
      },
      services,
      [
        {
          serviceId: 'from-zero',
          serviceName: 'РћС‚РґРµР» РїСЂРѕРґР°Р¶ СЃ РЅСѓР»СЏ',
          priority: RecommendationPriority.Urgent,
          rationale: 'llm',
          diagnosticSignals: ['ai_generated'],
          score: 100,
        },
        {
          serviceId: 'crm-start',
          serviceName: 'CRM РЎС‚Р°СЂС‚',
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
            description: 'РќР°РІРµСЃС‚Рё РїРѕСЂСЏРґРѕРє РІ СЂР°Р±РѕС‚Рµ 2 РјРµРЅРµРґР¶РµСЂРѕРІ',
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
            description: 'РќР°РІРµСЃС‚Рё РїРѕСЂСЏРґРѕРє РІ СЂР°Р±РѕС‚Рµ 2 РјРµРЅРµРґР¶РµСЂРѕРІ',
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
          serviceName: 'Р‘Р°Р·РѕРІР°СЏ РЅР°СЃС‚СЂРѕР№РєР° СЂР°Р±РѕС‚С‹ РѕС‚РґРµР»Р° РїСЂРѕРґР°Р¶',
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

  it('treats the questionnaire value "РќРµС‚, РїСЂРѕРґСѓРєС‚ РЅРѕРІС‹Р№" as a new sales department', () => {
    const result = ranker.rankRecommendations(
      {
        userId: 'user-id',
        clientProfile: {
          productStage: 'РќРµС‚, РїСЂРѕРґСѓРєС‚ РЅРѕРІС‹Р№',
          targetResult: 'РЈРІРµР»РёС‡РёС‚СЊ РїСЂРѕРґР°Р¶Рё РІ РєРѕРјР°РЅРґРµ РёР· 6 РјРµРЅРµРґР¶РµСЂРѕРІ',
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
          productStage: 'РќРѕРІС‹Р№',
          leadGenerationType: 'Р’С…РѕРґСЏС‰Р°СЏ',
          targetResult: 'РџРѕСЃС‚СЂРѕРёС‚СЊ РѕС‚РґРµР» РїСЂРѕРґР°Р¶ СЃ РЅСѓР»СЏ',
          desiredSalesDepartment: [
            'РўРµР»РµС„РѕРЅРёСЏ',
            'РњРµСЃСЃРµРЅРґР¶РµСЂ',
            'РњРµРЅРµРґР¶РµСЂ РїРѕ РїСЂРѕРґР°Р¶Р°Рј',
          ],
        },
        persist: false,
      },
      services,
      [
        {
          serviceId: 'crm-audit',
          serviceName: 'РђСѓРґРёС‚ CRM',
          priority: RecommendationPriority.Urgent,
          rationale: 'llm',
          diagnosticSignals: ['ai_generated'],
          score: 100,
        },
        {
          serviceId: 'crm-funnels',
          serviceName: 'РќР°СЃС‚СЂРѕР№РєР° РІРѕСЂРѕРЅРѕРє СЃРґРµР»РѕРє (РґРѕ 3 С€С‚)',
          priority: RecommendationPriority.Urgent,
          rationale: 'llm',
          diagnosticSignals: ['ai_generated'],
          score: 100,
        },
        {
          serviceId: 'crm-tech-spec',
          serviceName: 'РџРѕРґРіРѕС‚РѕРІРєР° С‚РµС…РЅРёС‡РµСЃРєРѕРіРѕ Р·Р°РґР°РЅРёСЏ',
          priority: RecommendationPriority.Urgent,
          rationale: 'llm',
          diagnosticSignals: ['ai_generated'],
          score: 100,
        },
        {
          serviceId: 'crm-report-setup',
          serviceName: 'РќР°СЃС‚СЂРѕР№РєР° РѕС‚С‡С‘С‚Р°',
          priority: RecommendationPriority.Urgent,
          rationale: 'llm',
          diagnosticSignals: ['ai_generated'],
          score: 100,
        },
        {
          serviceId: 'crm-deals-report',
          serviceName: 'РћС‚С‡РµС‚ РїРѕ РІРµРґРµРЅРёСЋ СЃРґРµР»РѕРє РІ CRM',
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
            description: 'РџРѕСЃС‚СЂРѕРёС‚СЊ РѕС‚РґРµР» РїСЂРѕРґР°Р¶ СЃ РЅСѓР»СЏ',
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
          serviceName: 'РђСѓРґРёС‚ CRM',
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

  it('keeps productStage=existing authoritative over contradictory free text', () => {
    const result = ranker.rankRecommendations(
      {
        userId: 'user-id',
        clientProfile: {
          productStage: 'existing',
          desiredResult: {
            period: '1m',
            description:
              'РѕС‚СЃСѓС‚СЃС‚РІСѓРµС‚ РѕС‚РґРµР» РїСЂРѕРґР°Р¶, РЅСѓР¶РЅРѕ РЅР°СЃС‚СЂРѕРёС‚СЊ РѕС‚РґРµР» РїСЂРѕРґР°Р¶',
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

    expect(result.map((item) => item.serviceId)).not.toContain('from-zero');
  });

  it('does not recommend three-month packages for a one-month goal', () => {
    const result = ranker.rankRecommendations(
      {
        userId: 'user-id',
        clientProfile: {
          productStage: 'existing',
          desiredResult: {
            period: '1m',
            description: 'РќСѓР¶РЅРѕ Р±С‹СЃС‚СЂРѕ РѕР±СѓС‡РёС‚СЊ РјРµРЅРµРґР¶РµСЂРѕРІ Р·Р° РјРµСЃСЏС†',
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
          serviceName: 'РџР°РєРµС‚ РѕР±СѓС‡РµРЅРёСЏ РЅР° 3 РјРµСЃСЏС†Р°',
          priority: RecommendationPriority.Urgent,
          rationale: 'llm',
          diagnosticSignals: ['ai_generated'],
          score: 100,
        },
        {
          serviceId: 'training-1m',
          serviceName: 'РџР°РєРµС‚ РѕР±СѓС‡РµРЅРёСЏ РЅР° РјРµСЃСЏС†',
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
            description: 'РџРѕСЃС‚СЂРѕРёС‚СЊ РѕС‚РґРµР» РїСЂРѕРґР°Р¶ СЃ РЅСѓР»СЏ',
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
          productStage: 'РЈР¶Рµ РїСЂРѕРґР°СЋ',
          targetResult: 'РќСѓР¶РЅС‹ CRM, Р°РЅР°Р»РёС‚РёРєР°, С‚РµР»РµС„РѕРЅРёСЏ Рё РєРѕРЅС‚СЂРѕР»СЊ РєР°С‡РµСЃС‚РІР°',
          desiredRevenue: 15000000,
          calculatedManagersCount: 8,
          desiredSalesDepartment: [
            'CRM',
            'РўРµР»РµС„РѕРЅРёСЏ',
            'РњРµСЃСЃРµРЅРґР¶РµСЂ',
            'РђРЅР°Р»РёС‚РёРєР°',
            'РђРЅР°Р»РёР· Р·РІРѕРЅРєРѕРІ',
            'Р РћРџ',
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
            description: 'РњР°СЃС€С‚Р°Р±РёСЂРѕРІР°С‚СЊ РїСЂРѕРґР°Р¶Рё Рё СѓРїСЂР°РІР»СЏС‚СЊ РѕС‚РґРµР»РѕРј РїРѕ РґР°РЅРЅС‹Рј',
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
            description: 'РњР°СЃС€С‚Р°Р±РёСЂРѕРІР°С‚СЊ РѕС‚РґРµР» РїСЂРѕРґР°Р¶ РґРѕ 8 РјРµРЅРµРґР¶РµСЂРѕРІ',
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

  it('selects one-month training, CRM Start, AI analyses and launch ROP for the new-OP questionnaire', () => {
    const extendedServices = [
      ...services,
      service('ai-docs', 'РР Р°РЅР°Р»РёР· РґРѕРєСѓРјРµРЅС‚РѕРІ'),
      service('ai-crm', 'РР Р°РЅР°Р»РёР· CRM'),
      service('ai-calls', 'РР Р°РЅР°Р»РёР· Р·РІРѕРЅРєРѕРІ Рё РјРµРЅРµРґР¶РµСЂРѕРІ'),
      service('rop-expert', 'Р­РєСЃРїРµСЂС‚ Р РћРџ: РєРѕРЅСЃСѓР»СЊС‚Р°С†РёСЏ'),
    ];
    const result = ranker.rankRecommendations(
      {
        userId: 'user-id',
        clientProfile: {
          productStage: 'РќРµС‚, РїСЂРѕРґСѓРєС‚ РЅРѕРІС‹Р№',
          desiredResult: { period: '1 РјРµСЃСЏС†', description: 'Р—Р°РїСѓСЃС‚РёС‚СЊ РћРџ' },
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
    expect(names).toEqual(
      expect.arrayContaining([
        'РџР°РєРµС‚ РѕР±СѓС‡РµРЅРёСЏ РЅР° РјРµСЃСЏС†',
        'CRM РЎС‚Р°СЂС‚',
        'РР Р°РЅР°Р»РёР· РґРѕРєСѓРјРµРЅС‚РѕРІ',
        'РР Р°РЅР°Р»РёР· CRM',
        'РР Р°РЅР°Р»РёР· Р·РІРѕРЅРєРѕРІ Рё РјРµРЅРµРґР¶РµСЂРѕРІ',
        'Р СѓРєРѕРІРѕРґРёС‚РµР»СЊ РѕС‚РґРµР»Р° РїСЂРѕРґР°Р¶',
      ]),
    );
    expect(names).not.toContain('Р­РєСЃРїРµСЂС‚ Р РћРџ: РєРѕРЅСЃСѓР»СЊС‚Р°С†РёСЏ');
    expect(names).not.toContain('РџР°РєРµС‚ РѕР±СѓС‡РµРЅРёСЏ РЅР° 3 РјРµСЃСЏС†Р°');
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
          desiredResult: { period: '1m', description: 'Р—Р°РїСѓСЃС‚РёС‚СЊ РїСЂРѕРґР°Р¶Рё' },
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
    expect(targetIds).toEqual(
      expect.arrayContaining([
        RECOMMENDATION_CATALOG.salesDepartmentFromZero.id,
        RECOMMENDATION_CATALOG.crmStart.id,
        RECOMMENDATION_CATALOG.trainingOneMonth.id,
        RECOMMENDATION_CATALOG.aiCrmAnalysis.id,
        RECOMMENDATION_CATALOG.aiDocumentAnalysis.id,
        RECOMMENDATION_CATALOG.aiCallManagersAnalysis.id,
        RECOMMENDATION_CATALOG.salesHead.id,
      ]),
    );
    expect(targetIds).not.toContain(
      RECOMMENDATION_CATALOG.trainingThreeMonths.id,
    );
  });

  it('keeps AI document analysis and one-month training for an existing outbound split flow by catalog ID', () => {
    const configuredCatalog = RECOMMENDATION_CATALOG_ENTRIES.map((entry) => ({
      ...service(
        entry.id,
        entry.id === RECOMMENDATION_CATALOG.trainingThreeMonths.id
          ? 'РџРµСЂРµРёРјРµРЅРѕРІР°РЅРЅС‹Р№ РїР°РєРµС‚ РѕР±СѓС‡РµРЅРёСЏ'
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
            description: 'РЈСЃРёР»РёС‚СЊ СЃСѓС‰РµСЃС‚РІСѓСЋС‰РёР№ РѕС‚РґРµР» РїСЂРѕРґР°Р¶',
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
          serviceName: 'РџРµСЂРµРёРјРµРЅРѕРІР°РЅРЅС‹Р№ РїР°РєРµС‚ РѕР±СѓС‡РµРЅРёСЏ',
          priority: RecommendationPriority.Urgent,
          rationale: 'llm',
          diagnosticSignals: ['ai_generated'],
          score: 100,
        },
      ],
      '',
    );

    const targetIds = result.map((item) => item.packageId ?? item.serviceId);

    expect(targetIds).toContain(RECOMMENDATION_CATALOG.crmStart.id);
    expect(targetIds).toContain(RECOMMENDATION_CATALOG.aiDocumentAnalysis.id);
    expect(targetIds).toContain(RECOMMENDATION_CATALOG.trainingOneMonth.id);
    expect(targetIds).not.toContain(
      RECOMMENDATION_CATALOG.trainingThreeMonths.id,
    );

    const compacted = selectNonOverlappingRecommendations(
      result.map((item) => {
        if (
          (item.packageId ?? item.serviceId) ===
          RECOMMENDATION_CATALOG.crmStart.id
        ) {
          return {
            ...item,
            serviceId: null,
            packageId: RECOMMENDATION_CATALOG.crmStart.id,
            coveredServiceIds: [
                RECOMMENDATION_CATALOG.telephonyIntegration.id,
                RECOMMENDATION_CATALOG.messengerIntegration.id,
            ],
          };
        }
        return item;
      }),
    );
    const compactedTargetIds = compacted.map(
      (item) => item.packageId ?? item.serviceId,
    );
    expect(compactedTargetIds).toContain(RECOMMENDATION_CATALOG.crmStart.id);
    expect(compactedTargetIds).not.toEqual(
      expect.arrayContaining([
                RECOMMENDATION_CATALOG.telephonyIntegration.id,
                RECOMMENDATION_CATALOG.messengerIntegration.id,
      ]),
    );
  });

  it('matches the existing outbound questionnaire requested by the client', () => {
    const result = ranker.rankRecommendations(
      {
        userId: 'user-id',
        clientProfile: {
          productStage: 'existing',
          leadGenerationTypes: ['outbound'],
          desiredResult: { period: '3m', description: 'РЈСЃРёР»РёС‚СЊ С‚РµРєСѓС‰РёР№ РћРџ' },
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
      configuredCatalogWithCrmStartCoverage(),
      [],
      '',
    );

    const targetIds = result.map((item) => item.packageId ?? item.serviceId);
    expect(targetIds).toEqual(
      expect.arrayContaining([
        RECOMMENDATION_CATALOG.crmAudit.id,
        RECOMMENDATION_CATALOG.aiCrmAnalysis.id,
        RECOMMENDATION_CATALOG.crmDealsAnalysis.id,
        RECOMMENDATION_CATALOG.crmStart.id,
        RECOMMENDATION_CATALOG.aiDocumentAnalysis.id,
        RECOMMENDATION_CATALOG.salesDocumentsPackage.id,
        RECOMMENDATION_CATALOG.hiringOffice.id,
        RECOMMENDATION_CATALOG.trainingThreeMonths.id,
        RECOMMENDATION_CATALOG.salesHeadExpertConsultation.id,
      ]),
    );
    expect(targetIds).not.toContain(
      RECOMMENDATION_CATALOG.salesDepartmentFromZero.id,
    );
    expect(targetIds).not.toEqual(
      expect.arrayContaining([
                RECOMMENDATION_CATALOG.telephonyIntegration.id,
                RECOMMENDATION_CATALOG.messengerIntegration.id,
      ]),
    );
  });

  it('matches the new inbound questionnaire requested by the client', () => {
    const result = ranker.rankRecommendations(
      {
        userId: 'user-id',
        clientProfile: {
          productStage: 'new',
          leadGenerationTypes: ['inbound'],
          desiredResult: { period: '3m', description: 'Р—Р°РїСѓСЃС‚РёС‚СЊ РЅРѕРІС‹Р№ РћРџ' },
          components: components({
            crm: true,
            telephony: true,
            messenger: true,
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
      configuredCatalogWithCrmStartCoverage(),
      [],
      '',
    );

    const targetIds = result.map((item) => item.packageId ?? item.serviceId);
    expect(targetIds).toEqual(
      expect.arrayContaining([
        RECOMMENDATION_CATALOG.salesDepartmentFromZero.id,
        RECOMMENDATION_CATALOG.crmStart.id,
        RECOMMENDATION_CATALOG.hiringOffice.id,
        RECOMMENDATION_CATALOG.trainingThreeMonths.id,
        RECOMMENDATION_CATALOG.salesDocumentsPackage.id,
        RECOMMENDATION_CATALOG.salesHead.id,
        RECOMMENDATION_CATALOG.aiCrmAnalysis.id,
        RECOMMENDATION_CATALOG.aiDocumentAnalysis.id,
        RECOMMENDATION_CATALOG.aiCallManagersAnalysis.id,
        RECOMMENDATION_CATALOG.rejectedDealsAnalysis.id,
        RECOMMENDATION_CATALOG.crmDealsAnalysis.id,
      ]),
    );
    expect(targetIds).not.toContain(
      RECOMMENDATION_CATALOG.salesHeadExpertConsultation.id,
    );
    expect(targetIds).not.toEqual(
      expect.arrayContaining([
                RECOMMENDATION_CATALOG.telephonyIntegration.id,
                RECOMMENDATION_CATALOG.messengerIntegration.id,
      ]),
    );
  });

  it('keeps the new-OP package and training for the full outbound questionnaire', () => {
    const result = ranker.rankRecommendations(
      {
        userId: 'user-id',
        clientProfile: {
          productStage: 'new',
          leadGenerationTypes: ['outbound'],
          desiredResult: { period: '3m', description: 'Р—Р°РїСѓСЃС‚РёС‚СЊ РїСЂРѕРґР°Р¶Рё' },
          components: components({
            crm: true,
            telephony: true,
            messenger: true,
            salesManager: true,
            analytics: true,
            scripts: true,
            callAnalysis: true,
            salesDocuments: true,
            salesHead: true,
          }),
        },
        persist: false,
      },
      configuredCatalogWithCrmStartCoverage(),
      [],
      '',
    );

    const targetIds = result.map((item) => item.packageId ?? item.serviceId);
    expect(targetIds).toEqual(
      expect.arrayContaining([
        RECOMMENDATION_CATALOG.salesDepartmentFromZero.id,
        RECOMMENDATION_CATALOG.crmStart.id,
        RECOMMENDATION_CATALOG.hiringOffice.id,
        RECOMMENDATION_CATALOG.trainingThreeMonths.id,
        RECOMMENDATION_CATALOG.salesDocumentsPackage.id,
        RECOMMENDATION_CATALOG.salesHead.id,
        RECOMMENDATION_CATALOG.aiCrmAnalysis.id,
        RECOMMENDATION_CATALOG.aiDocumentAnalysis.id,
        RECOMMENDATION_CATALOG.aiCallManagersAnalysis.id,
        RECOMMENDATION_CATALOG.rejectedDealsAnalysis.id,
        RECOMMENDATION_CATALOG.crmDealsAnalysis.id,
      ]),
    );
    expect(result.flatMap((item) => item.diagnosticSignals)).toContain(
      'ideal_reference:new_outbound_full_sales_department',
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
