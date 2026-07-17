import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { GenerateRecommendationsDto } from './dto/generate-recommendations.dto';
import { RecommendationPriority } from './entities/recommendation-priority.enum';
import {
  RECOMMENDATION_CATALOG,
  getRecommendationCatalogAliases,
  getRecommendationCatalogLegacyAliases,
  REQUIRED_RECOMMENDATION_CATALOG_ENTRIES,
  RecommendationCatalogKey,
} from './recommendation-catalog.registry';
import {
  GeneratedRecommendationItem,
  RecommendationScoringService,
  ServiceCandidate,
} from './recommendation-scoring.service';
import { selectNonOverlappingRecommendations } from './recommendation-coverage.util';

type QuestionnaireStage =
  | 'new_department'
  | 'basic_department'
  | 'advanced_department';

type ServiceGroup =
  | 'crm'
  | 'communications'
  | 'documents'
  | 'hiring'
  | 'analytics'
  | 'quality'
  | 'training'
  | 'management'
  | 'automation'
  | 'data'
  | 'other';

type RelevanceRule = {
  terms?: string[];
  catalogKeys?: RecommendationCatalogKey[];
  points: number;
  reason: string;
};

type ExistingComponentServiceMatcher = {
  catalogKeys?: RecommendationCatalogKey[];
  terms?: string[];
};

type DefaultServiceRule = {
  catalogKey: RecommendationCatalogKey;
  score: number;
  reason: string;
  requiredComponents?: SelectedComponent[];
};

type SelectedComponent =
  | 'crm'
  | 'telephony'
  | 'messenger'
  | 'voiceChatbot'
  | 'contactDatabase'
  | 'salesManager'
  | 'trainingSystem'
  | 'analytics'
  | 'scripts'
  | 'callAnalysis'
  | 'salesDocuments'
  | 'salesHead';

type IdealRecommendationReference = {
  id: string;
  match: {
    productStageAny?: string[];
    leadTypeAny?: string[];
    componentsAll?: SelectedComponent[];
    componentsAny?: SelectedComponent[];
    componentsAllowed?: SelectedComponent[];
  };
  recommendations: Array<{
    catalogKey: RecommendationCatalogKey;
    referenceName: string;
    aliases: string[];
    score: number;
    reason: string;
  }>;
};

type NormalizedQuestionnaireProfile = {
  rawText: string;
  productStageText: string;
  desiredText: string;
  leadTypeText: string;
  desiredPeriod: string;
  selectedComponents: SelectedComponent[];
  existingComponents: SelectedComponent[];
  managersCount: number;
  targetRevenue: number;
};

const NEW_DEPARTMENT_DEFAULT_RULES: DefaultServiceRule[] = [
  {
    catalogKey: 'salesDepartmentFromZero',
    score: 100,
    reason: 'нет отдела продаж',
  },
  {
    catalogKey: 'crmStart',
    score: 95,
    reason: 'нужен стартовый CRM-контур',
    requiredComponents: ['crm', 'telephony', 'messenger'],
  },
  {
    catalogKey: 'hiringOffice',
    score: 90,
    reason: 'нужен первый менеджер по продажам',
    requiredComponents: ['salesManager'],
  },
  {
    catalogKey: 'telephonyIntegration',
    score: 85,
    reason: 'входящие обращения нужно фиксировать',
    requiredComponents: ['telephony'],
  },
  {
    catalogKey: 'messengerIntegration',
    score: 84,
    reason: 'входящие переписки нужно фиксировать',
    requiredComponents: ['messenger'],
  },
  {
    catalogKey: 'salesScript',
    score: 75,
    reason: 'нужны первые скрипты продаж',
    requiredComponents: ['scripts'],
  },
  {
    catalogKey: 'salesDocumentsPackage',
    score: 70,
    reason: 'нужны базовые документы отдела',
    requiredComponents: ['salesDocuments', 'scripts'],
  },
  {
    catalogKey: 'trainingThreeMonths',
    score: 78,
    reason: 'нужна системная подготовка новой команды',
    requiredComponents: ['trainingSystem'],
  },
  {
    catalogKey: 'salesHead',
    score: 76,
    reason: 'нужно управление запуском нового отдела',
    requiredComponents: ['salesHead'],
  },
];

const DIVERSITY_LIMITS: Record<ServiceGroup, number> = {
  crm: 4,
  communications: 2,
  documents: 2,
  hiring: 1,
  analytics: 2,
  quality: 1,
  training: 1,
  management: 2,
  automation: 1,
  data: 1,
  other: 2,
};

const URGENT_RANKER_SCORE = 70;
const MEDIUM_RANKER_SCORE = 12;
const EXPLICIT_COMPONENT_POINTS = 60;
const AI_ANALYSIS_COMPONENT_POINTS = 80;
const MIN_UNSELECTED_FALLBACK_SCORE = 25;
export const MIN_RECOMMENDATION_RANKING_SCORE = 20;

const COMPONENT_LABELS: Record<SelectedComponent, string[]> = {
  crm: ['CRM'],
  telephony: ['Телефония'],
  messenger: ['Мессенджер'],
  voiceChatbot: [
    'Голосовой и чат бот',
    'Чат-бот',
    'Голосовой робот',
    'Робот',
    'Автоматизация',
  ],
  contactDatabase: ['База контактов'],
  salesManager: ['Менеджер по продажам'],
  trainingSystem: ['Система обучения'],
  analytics: ['Аналитика'],
  scripts: ['Скрипты'],
  callAnalysis: ['Анализ звонков'],
  salesDocuments: ['Документы ОП', 'Документы отдела продаж'],
  salesHead: ['РОП'],
};

const EXISTING_COMPONENT_SERVICE_MATCHERS: Partial<
  Record<SelectedComponent, ExistingComponentServiceMatcher>
> = {
  crm: {
    catalogKeys: ['crmStart', 'crmBronze'],
    terms: ['базовая настройка работы отдела продаж'],
  },
  telephony: { catalogKeys: ['telephonyIntegration'] },
  messenger: { catalogKeys: ['messengerIntegration'] },
  voiceChatbot: {
    terms: ['настройка роботов', 'голосовой робот', 'чат-бот'],
  },
  contactDatabase: { terms: ['база контактов'] },
  salesManager: {
    terms: ['подбор под ключ', 'профиль вакансии', 'портрет соискателя'],
  },
  trainingSystem: { terms: ['план тренингов', 'пакет обучения'] },
  analytics: { catalogKeys: ['salesDashboard'] },
  scripts: { terms: ['скрипт продаж'] },
  callAnalysis: {
    catalogKeys: ['callAnalysis', 'communicationQualityControl'],
    terms: ['отчет по звонкам', 'отчет с оценкой прослушанных разговоров'],
  },
  salesDocuments: { catalogKeys: ['salesDocumentsPackage'] },
  salesHead: {
    catalogKeys: ['salesHead', 'salesHeadFocus'],
    terms: ['управление действующим оп'],
  },
};

const COMPONENT_RELEVANCE_RULES: Record<SelectedComponent, RelevanceRule[]> = {
  crm: [
    {
      catalogKeys: ['crmStart'],
      points: EXPLICIT_COMPONENT_POINTS,
      reason: 'CRM выбрана в анкете',
    },
    {
      catalogKeys: ['crmBronze'],
      points: EXPLICIT_COMPONENT_POINTS,
      reason: 'CRM выбрана в анкете',
    },
    {
      terms: ['технического задания'],
      points: 6,
      reason: 'CRM выбрана в анкете',
    },
  ],
  telephony: [
    {
      catalogKeys: ['telephonyIntegration'],
      points: EXPLICIT_COMPONENT_POINTS,
      reason: 'телефония выбрана в анкете',
    },
  ],
  messenger: [
    {
      catalogKeys: ['messengerIntegration'],
      points: EXPLICIT_COMPONENT_POINTS,
      reason: 'мессенджер выбран в анкете',
    },
  ],
  voiceChatbot: [
    {
      catalogKeys: ['voiceAutomation'],
      points: EXPLICIT_COMPONENT_POINTS,
      reason: 'голосовой и чат бот выбран в анкете',
    },
  ],
  contactDatabase: [
    {
      catalogKeys: ['contactDatabase'],
      points: EXPLICIT_COMPONENT_POINTS,
      reason: 'база контактов выбрана в анкете',
    },
  ],
  salesManager: [
    {
      catalogKeys: ['hiringOffice'],
      points: EXPLICIT_COMPONENT_POINTS,
      reason: 'нужен менеджер по продажам',
    },
    {
      terms: ['профиль вакансии'],
      points: 8,
      reason: 'нужно описать профиль кандидата',
    },
  ],
  trainingSystem: [
    {
      terms: ['план тренингов'],
      points: EXPLICIT_COMPONENT_POINTS,
      reason: 'система обучения выбрана в анкете',
    },
    {
      terms: ['тренинг'],
      points: 10,
      reason: 'нужно развивать навыки менеджеров',
    },
    {
      terms: ['адаптации моп'],
      points: 8,
      reason: 'нужна адаптация менеджеров',
    },
  ],
  analytics: [
    {
      catalogKeys: ['salesDashboard'],
      points: EXPLICIT_COMPONENT_POINTS,
      reason: 'аналитика выбрана в анкете',
    },
    { terms: ['отказ'], points: 8, reason: 'нужно разбирать потери сделок' },
  ],
  scripts: [
    {
      catalogKeys: ['salesScript'],
      points: EXPLICIT_COMPONENT_POINTS,
      reason: 'скрипты выбраны в анкете',
    },
  ],
  callAnalysis: [
    {
      terms: ['ии анализ звонков и менеджеров'],
      points: AI_ANALYSIS_COMPONENT_POINTS,
      reason: 'нужно оценивать звонки',
    },
    {
      catalogKeys: ['callAnalysis'],
      points: EXPLICIT_COMPONENT_POINTS,
      reason: 'нужно оценивать звонки',
    },
    {
      catalogKeys: ['aiCallManagersAnalysis'],
      points: AI_ANALYSIS_COMPONENT_POINTS,
      reason: 'AI call analysis selected in questionnaire',
    },
  ],
  salesDocuments: [
    {
      catalogKeys: ['salesDocumentsPackage'],
      points: EXPLICIT_COMPONENT_POINTS,
      reason: 'документы ОП выбраны в анкете',
    },
  ],
  salesHead: [
    {
      terms: ['эксперт роп'],
      points: EXPLICIT_COMPONENT_POINTS,
      reason: 'выбран РОП — нужна экспертная консультация',
    },
    {
      catalogKeys: ['salesHeadFocus'],
      points: EXPLICIT_COMPONENT_POINTS,
      reason: 'РОП выбран в анкете',
    },
    {
      catalogKeys: ['salesHead'],
      points: EXPLICIT_COMPONENT_POINTS,
      reason: 'нужно усилить управление отделом',
    },
    {
      catalogKeys: ['aiSalesHead'],
      points: 24,
      reason: 'нужно управлять отделом по данным',
    },
    {
      catalogKeys: ['salesHead'],
      points: EXPLICIT_COMPONENT_POINTS,
      reason: 'ROP expert service selected in questionnaire',
    },
  ],
};

const EXISTING_COMPONENT_RELEVANCE_RULES: Partial<
  Record<SelectedComponent, RelevanceRule[]>
> = {
  crm: [
    {
      terms: ['crm старт'],
      points: EXPLICIT_COMPONENT_POINTS,
      reason: 'для существующей CRM нужен стартовый CRM-контур',
    },
    {
      terms: ['ии анализ crm'],
      points: AI_ANALYSIS_COMPONENT_POINTS,
      reason: 'в анкете указана существующая CRM, нужен ИИ-анализ',
    },
    {
      catalogKeys: ['crmAudit'],
      points: EXPLICIT_COMPONENT_POINTS,
      reason: 'в анкете указана существующая CRM, нужен аудит',
    },
    {
      catalogKeys: ['crmDealsAnalysis'],
      points: EXPLICIT_COMPONENT_POINTS,
      reason: 'в анкете указана существующая CRM, нужен анализ',
    },
    {
      catalogKeys: ['crmStart'],
      points: EXPLICIT_COMPONENT_POINTS,
      reason: 'existing CRM needs the CRM Start package',
    },
    {
      catalogKeys: ['aiCrmAnalysis'],
      points: AI_ANALYSIS_COMPONENT_POINTS,
      reason: 'existing CRM needs AI analysis',
    },
  ],
  analytics: [
    {
      terms: ['ии анализ дашборда'],
      points: AI_ANALYSIS_COMPONENT_POINTS,
      reason: 'существующая аналитика выбрана для ИИ-анализа',
    },
    {
      catalogKeys: ['salesDashboard'],
      points: EXPLICIT_COMPONENT_POINTS,
      reason: 'нужен анализ существующей аналитики',
    },
    {
      catalogKeys: ['aiDashboardAnalysis'],
      points: AI_ANALYSIS_COMPONENT_POINTS,
      reason: 'existing dashboard needs AI analysis',
    },
  ],
  salesDocuments: [
    {
      terms: ['ии анализ документов', 'анализ документов'],
      points: AI_ANALYSIS_COMPONENT_POINTS,
      reason: 'для документов ОП нужен ИИ-анализ',
    },
    {
      terms: ['ии анализ документов'],
      points: AI_ANALYSIS_COMPONENT_POINTS,
      reason: 'существующие документы ОП выбраны для ИИ-анализа',
    },
    {
      catalogKeys: ['documentAnalysis'],
      points: EXPLICIT_COMPONENT_POINTS,
      reason: 'нужен анализ существующих документов ОП',
    },
    {
      catalogKeys: ['aiDocumentAnalysis'],
      points: AI_ANALYSIS_COMPONENT_POINTS,
      reason: 'sales documents need AI analysis',
    },
  ],
  telephony: [
    {
      terms: ['ии анализ звонков и менеджеров'],
      points: AI_ANALYSIS_COMPONENT_POINTS,
      reason: 'существующая телефония выбрана для ИИ-анализа звонков',
    },
    {
      catalogKeys: ['callAnalysis'],
      points: EXPLICIT_COMPONENT_POINTS,
      reason: 'нужен анализ звонков существующей телефонии',
    },
    {
      catalogKeys: ['aiCallManagersAnalysis'],
      points: AI_ANALYSIS_COMPONENT_POINTS,
      reason: 'existing telephony needs AI call analysis',
    },
  ],
  callAnalysis: [
    {
      terms: ['ии анализ звонков и менеджеров'],
      points: AI_ANALYSIS_COMPONENT_POINTS,
      reason: 'нужен анализ звонков и работы менеджеров',
    },
    {
      catalogKeys: ['callAnalysis'],
      points: EXPLICIT_COMPONENT_POINTS,
      reason: 'нужен анализ звонков и работы менеджеров',
    },
    {
      catalogKeys: ['aiCallManagersAnalysis'],
      points: AI_ANALYSIS_COMPONENT_POINTS,
      reason: 'call analysis selected in questionnaire',
    },
  ],
  messenger: [
    {
      catalogKeys: ['messengerAnalysis'],
      points: EXPLICIT_COMPONENT_POINTS,
      reason: 'нужен анализ переписок в существующем мессенджере',
    },
  ],
  scripts: [
    {
      catalogKeys: ['aiDocumentAnalysis'],
      points: AI_ANALYSIS_COMPONENT_POINTS,
      reason: 'существующие скрипты требуют ИИ-анализа документов',
    },
  ],
  salesHead: [
    {
      terms: ['эксперт роп', 'экспертная консультация', 'консультация роп'],
      points: EXPLICIT_COMPONENT_POINTS,
      reason: 'выбран РОП — нужна экспертная консультация',
    },
    {
      catalogKeys: ['aiSalesHead'],
      points: EXPLICIT_COMPONENT_POINTS,
      reason: 'нужна экспертная консультация для существующего РОПа',
    },
    {
      catalogKeys: ['salesHead'],
      points: EXPLICIT_COMPONENT_POINTS,
      reason: 'existing ROP needs expert support',
    },
  ],
};

// These references are intentionally sales-direction agnostic. The client
// examples were B2B, but the same questionnaire shape should get the same
// baseline recommendations for similar non-B2B cases.
const IDEAL_RECOMMENDATION_REFERENCES: IdealRecommendationReference[] = [
  {
    id: 'new_outbound_full_sales_department',
    match: {
      productStageAny: ['новый', 'new'],
      leadTypeAny: ['исход', 'outbound'],
      componentsAll: [
        'crm',
        'telephony',
        'messenger',
        'trainingSystem',
        'analytics',
        'salesHead',
      ],
      componentsAny: ['salesManager', 'contactDatabase'],
      componentsAllowed: [
        'crm',
        'telephony',
        'messenger',
        'contactDatabase',
        'salesManager',
        'trainingSystem',
        'analytics',
        'salesHead',
      ],
    },
    recommendations: [
      {
        catalogKey: 'salesDepartmentFromZero',
        referenceName: 'Пакет ОП с нуля',
        aliases: ['отдел продаж с нуля'],
        score: 130,
        reason:
          'золотой сценарий: новый B2B-продукт и исходящие продажи требуют запуска ОП',
      },
      {
        catalogKey: 'salesHead',
        referenceName: 'Руководитель отдела продаж',
        aliases: ['руководитель отдела продаж', 'роп на аутсорсинге'],
        score: 126,
        reason: 'золотой сценарий: нужен РОП-контур для создания отдела',
      },
      {
        catalogKey: 'trainingThreeMonths',
        referenceName: 'Пакет обучения на 3 месяца',
        aliases: ['пакет обучения на 3 месяца'],
        score: 122,
        reason: 'золотой сценарий: нужна системная подготовка команды',
      },
    ],
  },
  {
    id: 'existing_inbound_managed_sales_department',
    match: {
      productStageAny: ['уже продаю', 'existing'],
      leadTypeAny: ['вход', 'inbound'],
      componentsAll: [
        'telephony',
        'messenger',
        'trainingSystem',
        'analytics',
        'salesHead',
      ],
      componentsAllowed: [
        'telephony',
        'messenger',
        'trainingSystem',
        'analytics',
        'salesHead',
      ],
    },
    recommendations: [
      {
        catalogKey: 'crmStart',
        referenceName: 'Пакет CRM Старт',
        aliases: ['crm старт'],
        score: 130,
        reason:
          'золотой сценарий: входящие обращения нужно сразу фиксировать в CRM',
      },
      {
        catalogKey: 'trainingThreeMonths',
        referenceName: 'Пакет обучения на 3 месяца',
        aliases: ['пакет обучения на 3 месяца'],
        score: 126,
        reason: 'золотой сценарий: нужна системная подготовка менеджеров',
      },
      {
        catalogKey: 'salesHead',
        referenceName: 'Руководитель отдела продаж',
        aliases: ['руководитель отдела продаж', 'роп на аутсорсинге'],
        score: 106,
        reason:
          'золотой сценарий: нужен управленческий контур для действующего ОП',
      },
    ],
  },
];

@Injectable()
export class QuestionnaireRelevanceRankerService {
  constructor(private readonly scoringService: RecommendationScoringService) {}

  rankRecommendations(
    dto: GenerateRecommendationsDto,
    services: ServiceCandidate[],
    ranked: GeneratedRecommendationItem[],
    context: string,
    limit?: number,
  ): GeneratedRecommendationItem[] {
    const usesConfiguredCatalog = this.validateConfiguredCatalog(services);
    const maxItems = limit ?? Number.POSITIVE_INFINITY;
    const profile = dto.clientProfile ?? {};
    const normalizedProfile = this.normalizeProfile(profile);
    const idealReference = this.findIdealReference(normalizedProfile);
    const stage = this.resolveStageForRanking(
      this.detectStage(normalizedProfile),
      idealReference,
    );
    const rules = this.buildRules(normalizedProfile, stage);
    const rankedById = new Map(
      ranked.map((item, index) => [
        this.getItemTargetId(item),
        { item, index },
      ]),
    );
    let defaultItems: GeneratedRecommendationItem[] = [];
    let idealItems: GeneratedRecommendationItem[] = [];

    if (idealReference) {
      idealItems = this.buildIdealReferenceRecommendations(
        idealReference,
        services,
        rankedById,
        context,
        normalizedProfile.desiredPeriod,
        Number.POSITIVE_INFINITY,
      );
    } else if (stage === 'new_department') {
      defaultItems = this.buildNewDepartmentDefaultRecommendations(
        services,
        rankedById,
        context,
        normalizedProfile,
        stage,
        maxItems,
      );

      if (defaultItems.length >= maxItems) {
        return this.finalizeRankedCandidates(defaultItems, new Set(), maxItems);
      }

      if (
        normalizedProfile.selectedComponents.length === 0 &&
        ranked.length === 0
      ) {
        return this.finalizeRankedCandidates(defaultItems, new Set(), maxItems);
      }
    }

    const defaultTargetIds = new Set(
      [...idealItems, ...defaultItems].map((item) =>
        this.getItemTargetId(item),
      ),
    );
    const idealTargetIds = new Set(
      idealItems.map((item) => this.getItemTargetId(item)),
    );
    const rankedCandidates: GeneratedRecommendationItem[] = [
      ...idealItems,
      ...defaultItems,
    ];

    for (const service of services) {
      const targetId = this.getCandidateTargetId(service);
      if (defaultTargetIds.has(targetId)) continue;

      const serviceNameText = this.normalize(service.name);
      if (
        this.shouldSkipCandidateByAntiFilters(service, normalizedProfile, stage)
      ) {
        continue;
      }

      const fromRanked = rankedById.get(targetId);
      const fallback = this.scoringService.scoreService(service, context);
      const matchedRules = rules.filter((rule) =>
        this.matchesRelevanceRule(
          rule,
          service,
          serviceNameText,
          usesConfiguredCatalog,
        ),
      );
      const rulePoints = matchedRules.reduce(
        (sum, rule) => sum + rule.points,
        0,
      );
      const llmBonus = fromRanked ? Math.max(8 - fromRanked.index, 1) : 0;

      if (
        !fromRanked &&
        rulePoints <= 0 &&
        fallback.score < MIN_UNSELECTED_FALLBACK_SCORE
      ) {
        continue;
      }

      const base = fromRanked?.item ?? fallback;
      const score = Number(base.score || 0) + rulePoints + llmBonus;
      const reasons = matchedRules.map((rule) => rule.reason);
      rankedCandidates.push({
        ...base,
        priority: this.resolveBoostedPriority(score, base.priority),
        rationale:
          reasons.length > 0
            ? this.buildRationale(service.name, reasons)
            : base.rationale,
        diagnosticSignals: this.scoringService.normalizeSignals([
          ...(base.diagnosticSignals ?? []),
          ...reasons,
        ]),
        score,
      });
    }

    return this.finalizeRankedCandidates(
      rankedCandidates,
      idealTargetIds,
      maxItems,
    );
  }

  private finalizeRankedCandidates(
    candidates: GeneratedRecommendationItem[],
    idealTargetIds: Set<string>,
    maxItems: number,
  ): GeneratedRecommendationItem[] {
    const relevantCandidates = candidates
      .filter(
        (item) => Number(item.score || 0) >= MIN_RECOMMENDATION_RANKING_SCORE,
      )
      .sort((a, b) => this.compareRankedCandidates(a, b, idealTargetIds));
    const compactedCandidates = this.collapseSupersededAnalysisRecommendations(
      this.collapseAlternativeHiringFormats(relevantCandidates),
    );
    const packageCompactedCandidates = selectNonOverlappingRecommendations(
      compactedCandidates,
      { idealTargetIds },
    );

    return this.applyDiversity(packageCompactedCandidates, maxItems);
  }

  private collapseAlternativeHiringFormats(
    items: GeneratedRecommendationItem[],
  ): GeneratedRecommendationItem[] {
    const hasOffice = items.some((item) =>
      this.matchesCatalogRecommendation(item, 'hiringOffice'),
    );
    if (!hasOffice) return items;

    return items.filter(
      (item) =>
        !['офис pro', 'стандарт online', 'стандарт online pro'].includes(
          this.normalize(item.serviceName),
        ),
    );
  }

  private collapseSupersededAnalysisRecommendations(
    items: GeneratedRecommendationItem[],
  ): GeneratedRecommendationItem[] {
    const hasAiCallAnalysis = items.some((item) =>
      this.matchesCatalogRecommendation(item, 'aiCallManagersAnalysis'),
    );
    if (!hasAiCallAnalysis) return items;

    const supersededNames = [
      ...getRecommendationCatalogAliases('callAnalysis'),
      ...getRecommendationCatalogLegacyAliases(
        'communicationQualityControl',
      ).filter((alias) => this.normalize(alias).includes('рубичат')),
    ].map((alias) => this.normalize(alias));

    return items.filter((item) => {
      const name = this.normalize(item.serviceName);
      return !supersededNames.includes(name);
    });
  }

  private compareRankedCandidates(
    a: GeneratedRecommendationItem,
    b: GeneratedRecommendationItem,
    idealTargetIds: Set<string>,
  ): number {
    const aIsIdeal = idealTargetIds.has(this.getItemTargetId(a));
    const bIsIdeal = idealTargetIds.has(this.getItemTargetId(b));
    if (aIsIdeal !== bIsIdeal) return aIsIdeal ? -1 : 1;

    return Number(b.score || 0) - Number(a.score || 0);
  }

  private detectStage(
    profile: NormalizedQuestionnaireProfile,
  ): QuestionnaireStage {
    if (
      profile.productStageText === 'new' ||
      this.includesAny(profile.rawText, [
        'построить отдел продаж',
        'с нуля',
        'отсутствует отдел продаж',
        'нет отдела продаж',
        'продукт новый',
        'новый продукт',
        'нет оп',
      ])
    ) {
      return 'new_department';
    }

    if (
      profile.managersCount >= 5 ||
      profile.targetRevenue >= 10000000 ||
      this.includesAny(profile.desiredText, ['роп', 'бизнес тренер'])
    ) {
      return 'advanced_department';
    }

    return 'basic_department';
  }

  private resolveStageForRanking(
    detectedStage: QuestionnaireStage,
    idealReference: IdealRecommendationReference | null,
  ): QuestionnaireStage {
    if (idealReference?.id === 'new_outbound_full_sales_department') {
      return 'new_department';
    }

    return detectedStage;
  }

  private findIdealReference(
    profile: NormalizedQuestionnaireProfile,
  ): IdealRecommendationReference | null {
    return (
      IDEAL_RECOMMENDATION_REFERENCES.find((reference) =>
        this.matchesIdealReference(profile, reference),
      ) ?? null
    );
  }

  private matchesIdealReference(
    profile: NormalizedQuestionnaireProfile,
    reference: IdealRecommendationReference,
  ): boolean {
    const { match } = reference;
    const selectedComponents = new Set(profile.selectedComponents);

    if (
      match.productStageAny?.length &&
      !match.productStageAny.some((term) =>
        profile.productStageText.includes(this.normalize(term)),
      )
    ) {
      return false;
    }

    if (
      match.leadTypeAny?.length &&
      !match.leadTypeAny.some((term) =>
        profile.leadTypeText.includes(this.normalize(term)),
      )
    ) {
      return false;
    }

    if (
      match.componentsAll?.length &&
      !match.componentsAll.every((component) =>
        selectedComponents.has(component),
      )
    ) {
      return false;
    }

    if (
      match.componentsAny?.length &&
      !match.componentsAny.some((component) =>
        selectedComponents.has(component),
      )
    ) {
      return false;
    }

    if (
      match.componentsAllowed?.length &&
      profile.selectedComponents.some(
        (component) => !match.componentsAllowed!.includes(component),
      )
    ) {
      return false;
    }

    return true;
  }

  private buildIdealReferenceRecommendations(
    reference: IdealRecommendationReference,
    services: ServiceCandidate[],
    rankedById: Map<
      string,
      { item: GeneratedRecommendationItem; index: number }
    >,
    context: string,
    desiredPeriod: string,
    limit: number,
  ): GeneratedRecommendationItem[] {
    const selected: GeneratedRecommendationItem[] = [];
    const usedTargetIds = new Set<string>();

    for (const recommendation of reference.recommendations) {
      const catalogKey: RecommendationCatalogKey =
        recommendation.catalogKey === 'trainingThreeMonths' &&
        desiredPeriod === '1m'
          ? 'trainingOneMonth'
          : recommendation.catalogKey;
      const referenceName =
        catalogKey === recommendation.catalogKey
          ? recommendation.referenceName
          : RECOMMENDATION_CATALOG[catalogKey].displayName;
      const service = this.findCandidateByCatalogKey(
        services,
        catalogKey,
        usedTargetIds,
        catalogKey === recommendation.catalogKey
          ? this.getRecommendationAliases(recommendation)
          : getRecommendationCatalogAliases(catalogKey),
      );
      if (!service) {
        throw new InternalServerErrorException(
          `Golden recommendation catalog item is missing: ${referenceName}`,
        );
      }

      const targetId = this.getCandidateTargetId(service);
      usedTargetIds.add(targetId);
      const base =
        rankedById.get(targetId)?.item ??
        this.scoringService.scoreService(service, context);
      const score = Math.max(Number(base.score || 0), recommendation.score);

      selected.push({
        ...base,
        serviceId: service.packageId ? null : (service.serviceId ?? service.id),
        packageId: service.packageId ?? null,
        serviceName: service.name,
        priority: this.resolveBoostedPriority(score, base.priority),
        rationale: this.buildRationale(service.name, [
          recommendation.reason,
          `референс: ${referenceName}`,
        ]),
        diagnosticSignals: this.scoringService.normalizeSignals([
          ...(base.diagnosticSignals ?? []),
          `ideal_reference:${reference.id}`,
          referenceName,
          recommendation.reason,
        ]),
        score,
        coveredServiceIds: base.coveredServiceIds,
        coverageKeys: base.coverageKeys,
      });

      if (selected.length >= limit) break;
    }

    return selected.sort(
      (a, b) =>
        Number(b.score || 0) - Number(a.score || 0) ||
        this.scorePriority(b.priority) - this.scorePriority(a.priority),
    );
  }

  private getRecommendationAliases(
    recommendation: IdealRecommendationReference['recommendations'][number],
  ): string[] {
    return this.uniqueStrings([
      recommendation.referenceName,
      ...recommendation.aliases,
      ...getRecommendationCatalogAliases(recommendation.catalogKey),
    ]);
  }

  private validateConfiguredCatalog(services: ServiceCandidate[]): boolean {
    const candidateById = new Map(
      services.map((service) => [this.getCandidateTargetId(service), service]),
    );
    const hasAnyConfiguredId = REQUIRED_RECOMMENDATION_CATALOG_ENTRIES.some(
      (entry) => candidateById.has(entry.id),
    );
    if (!hasAnyConfiguredId) return false;

    const usedTargetIds = new Set<string>();
    let usesOnlyConfiguredIds = true;
    for (const entry of REQUIRED_RECOMMENDATION_CATALOG_ENTRIES) {
      let candidate: ServiceCandidate | null | undefined = candidateById.get(
        entry.id,
      );
      if (
        candidate &&
        usedTargetIds.has(this.getCandidateTargetId(candidate))
      ) {
        candidate = undefined;
      }
      if (!candidate) {
        usesOnlyConfiguredIds = false;
        candidate = this.findCandidateByAliases(
          services,
          [entry.displayName, ...entry.legacyAliases],
          usedTargetIds,
          entry.kind,
        );
      }
      if (!candidate) {
        throw new InternalServerErrorException(
          `Recommendation catalog item is missing: ${entry.displayName} (${entry.id})`,
        );
      }

      const candidateId = this.getCandidateTargetId(candidate);
      usedTargetIds.add(candidateId);
      const actualKind = candidate.packageId ? 'package' : 'service';
      if (actualKind !== entry.kind) {
        throw new InternalServerErrorException(
          `Recommendation catalog item has invalid kind: ${entry.displayName} (${entry.id}), expected ${entry.kind}`,
        );
      }
    }

    return usesOnlyConfiguredIds;
  }

  private findCandidateByCatalogKey(
    services: ServiceCandidate[],
    catalogKey: RecommendationCatalogKey,
    usedTargetIds: Set<string>,
    additionalAliases: string[] = [],
  ): ServiceCandidate | null {
    const entry = RECOMMENDATION_CATALOG[catalogKey];
    const exact = services.find((service) => {
      const targetId = this.getCandidateTargetId(service);
      const actualKind = service.packageId
        ? 'package'
        : service.serviceId
          ? 'service'
          : undefined;
      return (
        targetId === entry.id &&
        !usedTargetIds.has(targetId) &&
        actualKind === entry.kind
      );
    });
    if (exact) return exact;

    const aliases = [
      ...additionalAliases,
      ...getRecommendationCatalogAliases(catalogKey),
    ];
    return this.findCandidateByAliases(
      services,
      aliases,
      usedTargetIds,
      entry.kind,
    );
  }

  private matchesRelevanceRule(
    rule: RelevanceRule,
    service: ServiceCandidate,
    serviceNameText: string,
    usesConfiguredCatalog: boolean,
  ): boolean {
    if (rule.catalogKeys?.length) {
      const targetId = this.getCandidateTargetId(service);
      if (usesConfiguredCatalog) {
        return rule.catalogKeys.some(
          (key) => RECOMMENDATION_CATALOG[key].id === targetId,
        );
      }
      return rule.catalogKeys.some((key) => {
        return getRecommendationCatalogAliases(key).some((alias) =>
          serviceNameText.includes(this.normalize(alias)),
        );
      });
    }

    return Boolean(
      rule.terms?.every((term) =>
        serviceNameText.includes(this.normalize(term)),
      ),
    );
  }

  private uniqueStrings(values: string[]): string[] {
    return Array.from(
      new Set(values.map((value) => value.trim()).filter(Boolean)),
    );
  }

  private findCandidateByAliases(
    services: ServiceCandidate[],
    aliases: string[],
    usedTargetIds: Set<string>,
    expectedKind?: 'service' | 'package',
  ): ServiceCandidate | null {
    const normalizedAliases = Array.from(
      new Set(aliases.map((alias) => this.normalize(alias))),
    );
    for (const normalizedAlias of normalizedAliases) {
      const candidate = services.find((service) => {
        const targetId = this.getCandidateTargetId(service);
        const actualKind = service.packageId
          ? 'package'
          : service.serviceId
            ? 'service'
            : undefined;
        return (
          !usedTargetIds.has(targetId) &&
          (!expectedKind || !actualKind || actualKind === expectedKind) &&
          this.normalize(service.name) === normalizedAlias
        );
      });
      if (candidate) return candidate;
    }

    return null;
  }

  private matchesCatalogRecommendation(
    item: GeneratedRecommendationItem,
    catalogKey: RecommendationCatalogKey,
  ): boolean {
    return (
      this.getItemTargetId(item) === RECOMMENDATION_CATALOG[catalogKey].id ||
      getRecommendationCatalogAliases(catalogKey).some(
        (alias) => this.normalize(item.serviceName) === this.normalize(alias),
      )
    );
  }

  private matchesCatalogCandidate(
    service: ServiceCandidate,
    serviceNameText: string,
    catalogKey: RecommendationCatalogKey,
  ): boolean {
    return (
      this.getCandidateTargetId(service) ===
        RECOMMENDATION_CATALOG[catalogKey].id ||
      getRecommendationCatalogAliases(catalogKey).some((alias) =>
        serviceNameText.includes(this.normalize(alias)),
      )
    );
  }

  private matchesExistingComponentService(
    service: ServiceCandidate,
    serviceNameText: string,
    component: SelectedComponent,
  ): boolean {
    const matcher = EXISTING_COMPONENT_SERVICE_MATCHERS[component];
    if (!matcher) return false;

    return Boolean(
      matcher.catalogKeys?.some((catalogKey) =>
        this.matchesCatalogCandidate(service, serviceNameText, catalogKey),
      ) ||
      matcher.terms?.some((term) =>
        serviceNameText.includes(this.normalize(term)),
      ),
    );
  }

  private buildRules(
    profile: NormalizedQuestionnaireProfile,
    stage: QuestionnaireStage,
  ): RelevanceRule[] {
    const rules: RelevanceRule[] = [];
    const leadType = profile.leadTypeText;
    const add = (terms: string[], points: number, reason: string): void => {
      rules.push({ terms, points, reason });
    };
    const addCatalog = (
      catalogKeys: RecommendationCatalogKey[],
      points: number,
      reason: string,
    ): void => {
      rules.push({ catalogKeys, points, reason });
    };

    profile.selectedComponents.forEach((component) => {
      COMPONENT_RELEVANCE_RULES[component].forEach((rule) => rules.push(rule));
    });

    if (
      stage === 'basic_department' &&
      profile.selectedComponents.includes('crm')
    ) {
      addCatalog(['crmBronze'], 34, 'нужно привести небольшой отдел в систему');
    }

    profile.existingComponents.forEach((component) => {
      this.getExistingComponentRelevanceRules(component).forEach((rule) =>
        rules.push(rule),
      );
    });

    if (profile.selectedComponents.includes('trainingSystem')) {
      addCatalog(
        [
          profile.desiredPeriod === '1m'
            ? 'trainingOneMonth'
            : 'trainingThreeMonths',
        ],
        EXPLICIT_COMPONENT_POINTS,
        'система обучения выбрана в анкете',
      );
    }

    if (stage === 'new_department') {
      addCatalog(
        ['aiCrmAnalysis'],
        AI_ANALYSIS_COMPONENT_POINTS,
        'new sales department always includes AI CRM analysis',
      );
      addCatalog(
        ['aiDashboardAnalysis'],
        AI_ANALYSIS_COMPONENT_POINTS,
        'new sales department always includes AI dashboard analysis',
      );
      addCatalog(
        ['aiDocumentAnalysis'],
        AI_ANALYSIS_COMPONENT_POINTS,
        'new sales department always includes AI document analysis',
      );
      addCatalog(
        ['aiCallManagersAnalysis'],
        AI_ANALYSIS_COMPONENT_POINTS,
        'new sales department always includes AI call analysis',
      );
      if (profile.selectedComponents.includes('crm')) {
        add(
          ['ии анализ crm', 'анализ crm'],
          AI_ANALYSIS_COMPONENT_POINTS,
          'для нового ОП нужен ИИ-анализ CRM',
        );
      }
      if (profile.selectedComponents.includes('salesDocuments')) {
        add(
          ['ии анализ документов', 'анализ документов'],
          AI_ANALYSIS_COMPONENT_POINTS,
          'для нового ОП нужен ИИ-анализ документов',
        );
      }
      if (
        profile.selectedComponents.includes('telephony') ||
        profile.selectedComponents.includes('callAnalysis')
      ) {
        add(
          ['ии анализ звонков и менеджеров', 'анализ звонков и менеджеров'],
          AI_ANALYSIS_COMPONENT_POINTS,
          'для нового ОП нужен ИИ-анализ звонков и менеджеров',
        );
      }
    }

    if (
      profile.existingComponents.includes('crm') &&
      ['telephony', 'messenger'].every((component) =>
        profile.selectedComponents.includes(component as SelectedComponent),
      )
    ) {
      addCatalog(
        ['crmStart'],
        80,
        'пакет закрывает выбранные интеграции существующей CRM',
      );
    }

    if (leadType.includes('исход') || leadType.includes('outbound')) {
      addCatalog(
        ['salesScript'],
        8,
        'исходящая лидогенерация требует скриптов',
      );
      add(
        ['портрет соискателя'],
        5,
        'для исходящей лидогенерации нужен портрет',
      );
    }
    if (leadType.includes('вход') || leadType.includes('inbound')) {
      addCatalog(
        ['telephonyIntegration'],
        stage === 'new_department' ? 10 : 6,
        'входящие обращения нужно фиксировать',
      );
      addCatalog(
        ['messengerIntegration'],
        stage === 'new_department' ? 10 : 6,
        'входящие переписки нужно фиксировать',
      );
    }

    return rules;
  }

  private getExistingComponentRelevanceRules(
    component: SelectedComponent,
  ): RelevanceRule[] {
    return EXISTING_COMPONENT_RELEVANCE_RULES[component] ?? [];
  }

  private normalizeProfile(
    profile: Record<string, unknown>,
  ): NormalizedQuestionnaireProfile {
    const desiredSalesDepartment = this.toArray(profile.desiredSalesDepartment);
    const usesExistingAndDesiredComponents =
      this.isPlainObject(profile.componentsToAdd) &&
      this.isExistingProductStage(profile.productStage);
    const existingComponents = usesExistingAndDesiredComponents
      ? this.getSelectedComponents(profile.components, [])
      : [];
    const selectedComponents = this.getSelectedComponents(
      usesExistingAndDesiredComponents
        ? profile.componentsToAdd
        : profile.components,
      desiredSalesDepartment,
    );
    const componentTerms = selectedComponents.flatMap(
      (component) => COMPONENT_LABELS[component],
    );
    const desiredTerms = [
      ...desiredSalesDepartment,
      ...componentTerms,
      profile.desiredResult,
      profile.targetResult,
      profile.product,
      profile.industry,
    ];
    const canonicalLeadGenerationTypes = this.toArray(
      profile.leadGenerationTypes,
    );
    const leadGenerationTypes =
      canonicalLeadGenerationTypes.length > 0
        ? canonicalLeadGenerationTypes
        : this.toArray(profile.leadGenerationType);

    const rawParts = [
      profile.productStage,
      profile.targetResult,
      profile.desiredResult,
      profile.components,
      profile.desiredSalesDepartment,
    ];

    return {
      rawText: this.normalize(JSON.stringify(rawParts)),
      productStageText: this.normalize(String(profile.productStage ?? '')),
      desiredText: this.normalize(JSON.stringify(desiredTerms)),
      leadTypeText: this.normalize(JSON.stringify(leadGenerationTypes)),
      desiredPeriod: this.getDesiredPeriod(profile),
      selectedComponents,
      existingComponents,
      managersCount: Math.max(
        this.toNumber(profile.calculatedManagersCount),
        this.inferManagersCount(profile),
      ),
      targetRevenue:
        this.toNumber(profile.targetRevenue) ||
        this.toNumber(profile.desiredRevenue),
    };
  }

  private getDesiredPeriod(profile: Record<string, unknown>): string {
    const raw = this.isPlainObject(profile.desiredResult)
      ? String(profile.desiredResult.period ?? '')
      : String(profile.period ?? '');
    const normalized = this.normalize(raw);
    if (
      ['1m', '1 месяц', 'месяц', 'на месяц'].some((value) =>
        normalized.includes(this.normalize(value)),
      )
    )
      return '1m';
    if (
      ['3m', '3 месяца', 'три месяца', 'на 3 месяца'].some((value) =>
        normalized.includes(this.normalize(value)),
      )
    )
      return '3m';
    return normalized;
  }

  private isExistingProductStage(productStage: unknown): boolean {
    return this.includesAny(this.normalize(String(productStage ?? '')), [
      'existing',
      'уже продаю',
    ]);
  }

  private inferManagersCount(profile: Record<string, unknown>): number {
    const text = this.normalize(
      JSON.stringify([profile.targetResult, profile.desiredResult]),
    );
    const matches = Array.from(text.matchAll(/(\d+)\s+(?:менеджер|моп)/g));

    return matches.reduce((max, match) => {
      const count = this.toNumber(match[1]);
      return count > max ? count : max;
    }, 0);
  }

  private getSelectedComponents(
    componentsValue: unknown,
    desiredSalesDepartment: unknown[],
  ): SelectedComponent[] {
    const selected = new Set<SelectedComponent>();
    const components = this.isPlainObject(componentsValue)
      ? (componentsValue as Record<string, unknown>)
      : {};
    const componentKeys = Object.keys(COMPONENT_LABELS) as SelectedComponent[];

    componentKeys.forEach((component) => {
      if (components[component] === true) selected.add(component);
    });

    const legacyText = this.normalize(JSON.stringify(desiredSalesDepartment));
    componentKeys.forEach((component) => {
      if (
        COMPONENT_LABELS[component].some((label) =>
          legacyText.includes(this.normalize(label)),
        )
      ) {
        selected.add(component);
      }
    });

    return [...selected];
  }

  private toArray(value: unknown): unknown[] {
    if (Array.isArray(value)) return value;
    if (value === undefined || value === null || value === '') return [];
    return [value];
  }

  private toNumber(value: unknown): number {
    const numberValue = Number(value || 0);
    return Number.isFinite(numberValue) ? numberValue : 0;
  }

  private isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  private getAntiRecommendationReason(
    service: ServiceCandidate,
    stage: QuestionnaireStage,
    profile: NormalizedQuestionnaireProfile,
  ): string | null {
    const serviceText = this.normalize(service.name);
    const {
      desiredText,
      leadTypeText,
      desiredPeriod,
      existingComponents,
      selectedComponents,
    } = profile;
    const explicitlyRequestedOneMonthTraining =
      desiredPeriod === '1m' && selectedComponents.includes('trainingSystem');
    const crmStartClosesRequestedIntegrations =
      existingComponents.includes('crm') &&
      this.matchesCatalogCandidate(service, serviceText, 'crmStart') &&
      ['telephony', 'messenger'].every((component) =>
        selectedComponents.includes(component as SelectedComponent),
      );

    if (this.includesAny(serviceText, ['на контроле', 'рубичат'])) {
      return 'устаревшая услуга заменена ИИ-анализом';
    }

    const duplicatedExistingComponent = existingComponents.find(
      (component) =>
        !selectedComponents.includes(component) &&
        !(component === 'crm' && crmStartClosesRequestedIntegrations) &&
        this.matchesExistingComponentService(service, serviceText, component),
    );
    if (duplicatedExistingComponent) {
      return `${COMPONENT_LABELS[duplicatedExistingComponent][0]} уже есть и добавление компонента не выбрано в анкете`;
    }

    if (
      selectedComponents.includes('crm') &&
      !existingComponents.includes('crm') &&
      (this.matchesCatalogCandidate(service, serviceText, 'crmAudit') ||
        this.matchesCatalogCandidate(service, serviceText, 'crmDealsAnalysis'))
    ) {
      return 'CRM выбрана для внедрения, а не для аудита';
    }

    if (
      desiredPeriod === '1m' &&
      (this.matchesCatalogCandidate(
        service,
        serviceText,
        'trainingThreeMonths',
      ) ||
        this.includesAny(serviceText, [
          'на 3 месяца',
          '3 месяца',
          'трехмесяч',
          'трех месяцев',
          'трехмесячный',
        ]))
    ) {
      return 'срок услуги не соответствует цели на 1 месяц';
    }

    if (leadTypeText.includes('inbound') || leadTypeText.includes('вход')) {
      if (
        this.includesAny(serviceText, ['база контактов']) &&
        !this.includesAny(desiredText, ['база контактов'])
      ) {
        return 'база контактов не требуется для входящей лидогенерации';
      }
    }

    if (
      stage === 'new_department' &&
      (this.matchesCatalogCandidate(service, serviceText, 'aiSalesHead') ||
        this.matchesCatalogCandidate(service, serviceText, 'salesHeadFocus') ||
        this.matchesCatalogCandidate(service, serviceText, 'crmAudit') ||
        this.matchesCatalogCandidate(
          service,
          serviceText,
          'crmDealsAnalysis',
        ) ||
        this.matchesCatalogCandidate(service, serviceText, 'crmBronze') ||
        this.includesAny(serviceText, [
          'ии роп',
          'роп-фокус',
          'топ-фокус',
          'коммерческий директор',
          'финансовый директор',
          'эксперт-фокус',
          'аудит crm',
          'настройка воронок сделок',
          'подготовка технического задания',
          'отчет по ведению сделок',
          'отчёт по ведению сделок',
          'отчет с оценкой проанализированных переписок',
          'отчёт с оценкой проанализированных переписок',
          'аналитический отчет по отказным сделкам',
          'аналитический отчёт по отказным сделкам',
          'настройка отчета',
          'настройка отчёта',
          'на контроле',
          'crm бронза',
          'crm серебро',
          'crm золото',
          'стандарт online pro',
          'офис pro',
        ]))
    ) {
      return 'услуга рассчитана на более зрелый отдел продаж';
    }

    if (
      stage === 'advanced_department' &&
      (this.matchesCatalogCandidate(
        service,
        serviceText,
        'salesDepartmentFromZero',
      ) ||
        (this.matchesCatalogCandidate(
          service,
          serviceText,
          'trainingOneMonth',
        ) &&
          !explicitlyRequestedOneMonthTraining) ||
        (this.includesAny(desiredText, ['crm']) &&
          ((this.matchesCatalogCandidate(service, serviceText, 'crmStart') &&
            !crmStartClosesRequestedIntegrations) ||
            this.matchesCatalogCandidate(service, serviceText, 'crmBronze') ||
            this.includesAny(serviceText, [
              'базовая настройка работы отдела продаж',
            ]))))
    ) {
      return 'услуга слишком базовая для развитого отдела продаж';
    }

    if (
      stage === 'basic_department' &&
      !this.includesAny(desiredText, ['роп', 'руководител']) &&
      (this.matchesCatalogCandidate(service, serviceText, 'aiSalesHead') ||
        this.matchesCatalogCandidate(service, serviceText, 'salesHeadFocus') ||
        this.matchesCatalogCandidate(service, serviceText, 'salesHead') ||
        this.includesAny(serviceText, ['управление действующим оп']))
    ) {
      return 'РОП не выбран в анкете базового отдела';
    }

    if (
      stage === 'basic_department' &&
      (this.matchesCatalogCandidate(
        service,
        serviceText,
        'salesDepartmentFromZero',
      ) ||
        this.includesAny(serviceText, [
          'базовая настройка работы отдела продаж',
          'crm серебро',
          'crm золото',
          'топ-фокус',
          'коммерческий директор',
          'финансовый директор',
          'hrd',
        ]))
    ) {
      return 'услуга не соответствует текущей стадии отдела продаж';
    }

    if (
      stage === 'advanced_department' &&
      !this.includesAny(desiredText, [
        'менеджер по продажам',
        'подбор',
        'ваканси',
      ]) &&
      (this.matchesCatalogCandidate(service, serviceText, 'hiringOffice') ||
        this.includesAny(serviceText, [
          'скрининг',
          'стандарт online',
          'профиль вакансии',
          'портрет соискателя',
        ]))
    ) {
      return 'подбор персонала не выбран в анкете зрелого отдела';
    }

    return null;
  }

  private shouldSkipCandidateByAntiFilters(
    service: ServiceCandidate,
    profile: NormalizedQuestionnaireProfile,
    stage: QuestionnaireStage,
  ): boolean {
    return Boolean(this.getAntiRecommendationReason(service, stage, profile));
  }

  private applyDiversity(
    candidates: GeneratedRecommendationItem[],
    limit: number,
  ): GeneratedRecommendationItem[] {
    const selected: GeneratedRecommendationItem[] = [];
    const skipped: GeneratedRecommendationItem[] = [];
    const groupCounts = new Map<ServiceGroup, number>();

    for (const item of candidates) {
      if (this.isSemanticDuplicate(selected, item)) continue;
      const group = this.getServiceGroup(item);
      const currentCount = groupCounts.get(group) ?? 0;
      const max = DIVERSITY_LIMITS[group];

      if (selected.length < limit && currentCount < max) {
        selected.push(item);
        groupCounts.set(group, currentCount + 1);
      } else {
        skipped.push(item);
      }
    }

    if (!Number.isFinite(limit)) return selected;

    for (const item of skipped) {
      if (selected.length >= limit) break;
      if (
        !selected.some(
          (selectedItem) =>
            this.getItemTargetId(selectedItem) === this.getItemTargetId(item),
        )
      ) {
        selected.push(item);
      }
    }

    return selected;
  }

  private isSemanticDuplicate(
    selected: GeneratedRecommendationItem[],
    candidate: GeneratedRecommendationItem,
  ): boolean {
    if (!this.isSalesHeadVariant(candidate)) return false;
    return selected.some((item) => this.isSalesHeadVariant(item));
  }

  private isSalesHeadVariant(item: GeneratedRecommendationItem): boolean {
    return this.includesAny(this.normalize(item.serviceName), [
      'ии роп',
      'роп-фокус',
      'роп на аутсорсинге',
      'руководитель отдела продаж',
      'управление действующим оп',
    ]);
  }

  private buildNewDepartmentDefaultRecommendations(
    services: ServiceCandidate[],
    rankedById: Map<
      string,
      { item: GeneratedRecommendationItem; index: number }
    >,
    context: string,
    profile: NormalizedQuestionnaireProfile,
    stage: QuestionnaireStage,
    limit: number,
  ): GeneratedRecommendationItem[] {
    const selected: GeneratedRecommendationItem[] = [];
    const usedTargetIds = new Set<string>();

    for (const rule of NEW_DEPARTMENT_DEFAULT_RULES) {
      if (
        rule.requiredComponents?.length &&
        !rule.requiredComponents.some((component) =>
          profile.selectedComponents.includes(component),
        )
      ) {
        continue;
      }

      const catalogKey: RecommendationCatalogKey =
        rule.catalogKey === 'trainingThreeMonths' &&
        profile.desiredPeriod === '1m'
          ? 'trainingOneMonth'
          : rule.catalogKey;
      const service = this.findCandidateByCatalogKey(
        services,
        catalogKey,
        usedTargetIds,
      );

      if (!service) continue;
      if (this.shouldSkipCandidateByAntiFilters(service, profile, stage)) {
        continue;
      }

      const targetId = this.getCandidateTargetId(service);
      usedTargetIds.add(targetId);
      const base =
        rankedById.get(targetId)?.item ??
        this.scoringService.scoreService(service, context);

      selected.push({
        ...base,
        serviceId: service.packageId ? null : (service.serviceId ?? service.id),
        packageId: service.packageId ?? null,
        serviceName: service.name,
        priority: this.resolveBoostedPriority(
          Math.max(Number(base.score || 0), rule.score),
          base.priority,
        ),
        rationale: this.buildRationale(service.name, [rule.reason]),
        diagnosticSignals: this.scoringService.normalizeSignals([
          ...(base.diagnosticSignals ?? []),
          'default_new_department',
          rule.reason,
        ]),
        score: Math.max(Number(base.score || 0), rule.score),
        coveredServiceIds: base.coveredServiceIds,
        coverageKeys: base.coverageKeys,
      });

      if (selected.length >= limit) break;
    }

    return selected;
  }

  private resolveBoostedPriority(
    score: number,
    basePriority: RecommendationPriority,
  ): RecommendationPriority {
    if (basePriority === RecommendationPriority.Urgent) {
      return RecommendationPriority.Urgent;
    }
    if (score >= URGENT_RANKER_SCORE) return RecommendationPriority.Urgent;
    if (
      score >= MEDIUM_RANKER_SCORE ||
      basePriority === RecommendationPriority.Medium
    ) {
      return RecommendationPriority.Medium;
    }
    return RecommendationPriority.Low;
  }

  private scorePriority(priority: RecommendationPriority): number {
    if (priority === RecommendationPriority.Urgent) return 3;
    if (priority === RecommendationPriority.Medium) return 2;
    return 1;
  }

  private getServiceGroup(item: GeneratedRecommendationItem): ServiceGroup {
    const text = this.normalize(item.serviceName);

    if (text.includes('crm')) return 'crm';
    if (text === 'ии анализ звонков и менеджеров') return 'quality';
    if (
      this.includesAny(text, ['телефони', 'мессенджер', 'звонк', 'разговор'])
    ) {
      return 'communications';
    }
    if (
      this.includesAny(text, ['скрипт', 'документ', 'регламент', 'инструкц'])
    ) {
      return 'documents';
    }
    if (
      this.includesAny(text, ['подбор', 'ваканси', 'соискател', 'скрининг'])
    ) {
      return 'hiring';
    }
    if (this.includesAny(text, ['дашборд', 'аналит', 'отчет', 'отказ'])) {
      return 'analytics';
    }
    if (this.includesAny(text, ['контрол', 'качество', 'рубичат'])) {
      return 'quality';
    }
    if (this.includesAny(text, ['обуч', 'тренинг', 'адаптац', 'аттестац'])) {
      return 'training';
    }
    if (this.includesAny(text, ['роп', 'руководител', 'директор'])) {
      return 'management';
    }
    if (this.includesAny(text, ['робот', 'автоматизац'])) return 'automation';
    if (text.includes('баз контактов')) return 'data';
    return 'other';
  }

  private getCandidateTargetId(service: ServiceCandidate): string {
    return service.packageId ?? service.serviceId ?? service.id;
  }

  private getItemTargetId(item: GeneratedRecommendationItem): string {
    return item.packageId ?? item.serviceId ?? '';
  }

  private buildRationale(serviceName: string, reasons: string[]): string {
    const uniqueReasons = Array.from(new Set(reasons)).slice(0, 3);
    return `${serviceName}: рекомендация выбрана по анкете (${uniqueReasons.join(', ')}).`;
  }

  private includesAny(text: string, terms: string[]): boolean {
    return terms.some((term) => text.includes(this.normalize(term)));
  }

  private normalize(text: string): string {
    return text
      .normalize('NFKC')
      .toLowerCase()
      .replace(/ё/g, 'е')
      .replace(/[^\p{L}\p{N}_]+/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
}
