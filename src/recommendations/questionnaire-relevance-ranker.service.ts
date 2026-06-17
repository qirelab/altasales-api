import { Injectable } from '@nestjs/common';
import { GenerateRecommendationsDto } from './dto/generate-recommendations.dto';
import { RecommendationPriority } from './entities/recommendation-priority.enum';
import {
  GeneratedRecommendationItem,
  RecommendationScoringService,
  ServiceCandidate,
} from './recommendation-scoring.service';

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
  terms: string[];
  points: number;
  reason: string;
};

type DefaultServiceRule = {
  terms: string[];
  score: number;
  reason: string;
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
  };
  recommendations: Array<{
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
  managersCount: number;
  targetRevenue: number;
};

const NEW_DEPARTMENT_DEFAULT_RULES: DefaultServiceRule[] = [
  {
    terms: ['отдел продаж с нуля'],
    score: 100,
    reason: 'нет отдела продаж',
  },
  {
    terms: ['crm старт'],
    score: 95,
    reason: 'нужен стартовый CRM-контур',
  },
  {
    terms: ['подбор', 'ключ'],
    score: 90,
    reason: 'нужен первый менеджер по продажам',
  },
  {
    terms: ['интеграция телефонии'],
    score: 85,
    reason: 'входящие обращения нужно фиксировать',
  },
  {
    terms: ['интеграция мессенджера'],
    score: 84,
    reason: 'входящие переписки нужно фиксировать',
  },
  {
    terms: ['скрипт продаж'],
    score: 75,
    reason: 'нужны первые скрипты продаж',
  },
  {
    terms: ['пакет документов', 'отдел продаж'],
    score: 70,
    reason: 'нужны базовые документы отдела',
  },
];

const DIVERSITY_LIMITS: Record<ServiceGroup, number> = {
  crm: 2,
  communications: 2,
  documents: 1,
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

const COMPONENT_RELEVANCE_RULES: Record<SelectedComponent, RelevanceRule[]> = {
  crm: [
    {
      terms: ['crm'],
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
      terms: ['интеграция телефонии'],
      points: EXPLICIT_COMPONENT_POINTS,
      reason: 'телефония выбрана в анкете',
    },
  ],
  messenger: [
    {
      terms: ['интеграция мессенджера'],
      points: EXPLICIT_COMPONENT_POINTS,
      reason: 'мессенджер выбран в анкете',
    },
  ],
  voiceChatbot: [
    {
      terms: ['робот'],
      points: EXPLICIT_COMPONENT_POINTS,
      reason: 'голосовой и чат бот выбран в анкете',
    },
    {
      terms: ['автоматизац'],
      points: EXPLICIT_COMPONENT_POINTS,
      reason: 'голосовой и чат бот выбран в анкете',
    },
  ],
  contactDatabase: [
    {
      terms: ['баз контактов'],
      points: EXPLICIT_COMPONENT_POINTS,
      reason: 'база контактов выбрана в анкете',
    },
  ],
  salesManager: [
    {
      terms: ['подбор', 'ключ'],
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
      terms: ['дашборд оп'],
      points: EXPLICIT_COMPONENT_POINTS,
      reason: 'аналитика выбрана в анкете',
    },
    { terms: ['отказ'], points: 8, reason: 'нужно разбирать потери сделок' },
  ],
  scripts: [
    {
      terms: ['скрипт продаж'],
      points: EXPLICIT_COMPONENT_POINTS,
      reason: 'скрипты выбраны в анкете',
    },
  ],
  callAnalysis: [
    {
      terms: ['на контроле'],
      points: EXPLICIT_COMPONENT_POINTS,
      reason: 'анализ звонков выбран в анкете',
    },
    {
      terms: ['отчет', 'звонков'],
      points: EXPLICIT_COMPONENT_POINTS,
      reason: 'нужно оценивать звонки',
    },
  ],
  salesDocuments: [
    {
      terms: ['документ'],
      points: EXPLICIT_COMPONENT_POINTS,
      reason: 'документы ОП выбраны в анкете',
    },
  ],
  salesHead: [
    {
      terms: ['роп-фокус'],
      points: EXPLICIT_COMPONENT_POINTS,
      reason: 'РОП выбран в анкете',
    },
    {
      terms: ['руководитель отдела продаж'],
      points: EXPLICIT_COMPONENT_POINTS,
      reason: 'нужно усилить управление отделом',
    },
    {
      terms: ['ии роп'],
      points: EXPLICIT_COMPONENT_POINTS,
      reason: 'нужно управлять отделом по данным',
    },
  ],
};

const IDEAL_RECOMMENDATION_REFERENCES: IdealRecommendationReference[] = [
  {
    id: 'new_b2b_outbound_full_sales_department',
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
    },
    recommendations: [
      {
        referenceName: 'Пакет ОП с нуля',
        aliases: ['отдел продаж с нуля'],
        score: 130,
        reason:
          'золотой сценарий: новый B2B-продукт и исходящие продажи требуют запуска ОП',
      },
      {
        referenceName: 'Сопровождение создания ОП с нуля РОП',
        aliases: ['руководитель отдела продаж', 'роп на аутсорсинге'],
        score: 126,
        reason: 'золотой сценарий: нужен РОП-контур для создания отдела',
      },
      {
        referenceName: 'Пакет обучения на 3 месяца',
        aliases: ['пакет обучения на 3 месяца'],
        score: 122,
        reason: 'золотой сценарий: нужна системная подготовка команды',
      },
      {
        referenceName: 'ИИ анализ дашборда',
        aliases: ['дашборд оп', 'ии роп'],
        score: 118,
        reason: 'золотой сценарий: нужна управленческая аналитика отдела',
      },
      {
        referenceName: 'Интеграция с CRM',
        aliases: ['crm старт', 'базовая настройка работы отдела продаж'],
        score: 114,
        reason: 'золотой сценарий: нужен CRM-контур для фиксации продаж',
      },
      {
        referenceName: 'ИИ анализ CRM',
        aliases: ['аудит crm', 'отчет по ведению сделок в crm', 'ии роп'],
        score: 110,
        reason: 'золотой сценарий: нужен анализ качества CRM-процесса',
      },
    ],
  },
  {
    id: 'existing_b2b_inbound_managed_sales_department',
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
    },
    recommendations: [
      {
        referenceName: 'Пакет CRM Старт',
        aliases: ['crm старт'],
        score: 130,
        reason:
          'золотой сценарий: входящие обращения нужно сразу фиксировать в CRM',
      },
      {
        referenceName: 'Пакет обучения на 3 месяца',
        aliases: ['пакет обучения на 3 месяца'],
        score: 126,
        reason: 'золотой сценарий: нужна системная подготовка менеджеров',
      },
      {
        referenceName: 'ИИ анализ дашборда',
        aliases: ['дашборд оп', 'ии роп'],
        score: 122,
        reason: 'золотой сценарий: нужна аналитика текущего отдела',
      },
      {
        referenceName: 'Интеграция с CRM',
        aliases: ['аудит crm', 'отчет по ведению сделок в crm'],
        score: 118,
        reason: 'золотой сценарий: нужно проверить и связать CRM-процесс',
      },
      {
        referenceName: 'ИИ анализ CRM',
        aliases: ['ии роп', 'на контроле'],
        score: 114,
        reason: 'золотой сценарий: нужен анализ CRM и коммуникаций',
      },
      {
        referenceName: 'ИИ анализ документов',
        aliases: ['документ под запрос', 'пакет документов отдела продаж'],
        score: 110,
        reason: 'золотой сценарий: нужно проверить документы и регламенты',
      },
      {
        referenceName: 'Управление действующим ОП РОП',
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
    const maxItems = limit ?? Number.POSITIVE_INFINITY;
    const profile = dto.clientProfile ?? {};
    const normalizedProfile = this.normalizeProfile(profile);
    const stage = this.detectStage(normalizedProfile);
    const rules = this.buildRules(normalizedProfile, stage);
    const desiredText = normalizedProfile.desiredText;
    const idealReference = this.findIdealReference(normalizedProfile);
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
        maxItems,
      );

      if (idealItems.length >= maxItems) {
        return idealItems.slice(0, maxItems);
      }
    } else if (stage === 'new_department') {
      defaultItems = this.buildNewDepartmentDefaultRecommendations(
        services,
        rankedById,
        context,
        maxItems,
      );

      if (defaultItems.length >= maxItems) {
        return defaultItems;
      }
    }

    const defaultTargetIds = new Set(
      [...idealItems, ...defaultItems].map((item) =>
        this.getItemTargetId(item),
      ),
    );
    const rankedCandidates: GeneratedRecommendationItem[] = [
      ...idealItems,
      ...defaultItems,
    ];

    for (const service of services) {
      const targetId = this.getCandidateTargetId(service);
      if (defaultTargetIds.has(targetId)) continue;

      const serviceText = this.normalizeCandidateText(service);
      if (
        this.getAntiRecommendationReason(
          serviceText,
          stage,
          desiredText,
          normalizedProfile.desiredPeriod,
        )
      ) {
        continue;
      }

      const fromRanked = rankedById.get(targetId);
      const fallback = this.scoringService.scoreService(service, context);
      const matchedRules = rules.filter((rule) =>
        rule.terms.every((term) => serviceText.includes(this.normalize(term))),
      );
      const rulePoints = matchedRules.reduce(
        (sum, rule) => sum + rule.points,
        0,
      );
      const llmBonus = fromRanked ? Math.max(8 - fromRanked.index, 1) : 0;

      if (!fromRanked && fallback.score <= 0 && rulePoints <= 0) continue;

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

    const diverse = this.applyDiversity(
      rankedCandidates.sort((a, b) => b.score - a.score),
      maxItems,
    );

    return diverse;
  }

  private detectStage(
    profile: NormalizedQuestionnaireProfile,
  ): QuestionnaireStage {
    if (
      this.includesAny(profile.rawText, [
        'построить отдел продаж',
        'с нуля',
        'отсутствует отдел продаж',
        'нет отдела продаж',
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
    limit: number,
  ): GeneratedRecommendationItem[] {
    const selected: GeneratedRecommendationItem[] = [];
    const usedTargetIds = new Set<string>();

    for (const recommendation of reference.recommendations) {
      const service = this.findCandidateByAliases(
        services,
        recommendation.aliases,
        usedTargetIds,
      );
      if (!service) continue;

      const targetId = this.getCandidateTargetId(service);
      usedTargetIds.add(targetId);
      const base =
        rankedById.get(targetId)?.item ??
        this.scoringService.scoreService(service, context);
      const score = Math.max(Number(base.score || 0), recommendation.score);

      selected.push({
        ...base,
        serviceId: base.serviceId,
        packageId: base.packageId,
        serviceName: service.name,
        priority: this.resolveBoostedPriority(score, base.priority),
        rationale: this.buildRationale(service.name, [
          recommendation.reason,
          `референс: ${recommendation.referenceName}`,
        ]),
        diagnosticSignals: this.scoringService.normalizeSignals([
          ...(base.diagnosticSignals ?? []),
          `ideal_reference:${reference.id}`,
          recommendation.referenceName,
          recommendation.reason,
        ]),
        score,
        coveredServiceIds: base.coveredServiceIds,
      });

      if (selected.length >= limit) break;
    }

    return selected;
  }

  private findCandidateByAliases(
    services: ServiceCandidate[],
    aliases: string[],
    usedTargetIds: Set<string>,
  ): ServiceCandidate | null {
    for (const alias of aliases) {
      const normalizedAlias = this.normalize(alias);
      const exactMatch = services.find((service) => {
        const targetId = this.getCandidateTargetId(service);
        return (
          !usedTargetIds.has(targetId) &&
          this.normalize(service.name) === normalizedAlias
        );
      });
      if (exactMatch) return exactMatch;

      const textMatch = services.find((service) => {
        const targetId = this.getCandidateTargetId(service);
        return (
          !usedTargetIds.has(targetId) &&
          this.normalizeCandidateText(service).includes(normalizedAlias)
        );
      });
      if (textMatch) return textMatch;
    }

    return null;
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

    if (stage === 'new_department') {
      add(['отдел продаж с нуля'], 36, 'клиент строит отдел продаж с нуля');
      add(['базовая'], 32, 'нужна базовая настройка отдела');
      add(['crm старт'], 22, 'нужен стартовый CRM-контур');
      add(
        ['пакет документов', 'отдел продаж'],
        18,
        'нужны базовые документы отдела',
      );
      add(['подбор', 'ключ'], 16, 'нужен подбор менеджеров');
      add(['скрипт продаж'], 8, 'нужны первые скрипты продаж');
    }

    if (stage === 'basic_department') {
      add(['crm бронза'], 34, 'нужно привести небольшой отдел в систему');
      add(['интеграция телефонии'], 20, 'нужно фиксировать звонки');
      add(['интеграция мессенджера'], 20, 'нужно фиксировать переписки');
      add(['скрипт продаж'], 18, 'нужно стандартизировать коммуникации');
      add(['отчет', 'звонков'], 16, 'нужен контроль качества звонков');
      add(['план тренингов'], 12, 'нужно обучать менеджеров');
    }

    if (stage === 'advanced_department') {
      add(
        ['дашборд оп'],
        26,
        'развитому отделу нужна управленческая аналитика',
      );
      add(['ии роп'], 24, 'нужно управлять командой по данным');
      add(['на контроле'], 22, 'нужен контроль качества коммуникаций');
      add(['crm серебро'], 18, 'нужна расширенная CRM-настройка');
      add(
        ['руководитель отдела продаж'],
        18,
        'нужно усиление управления продажами',
      );
      add(['роп-фокус'], 16, 'нужно усиление роли РОПа');
    }

    profile.selectedComponents.forEach((component) => {
      COMPONENT_RELEVANCE_RULES[component].forEach((rule) =>
        add(rule.terms, rule.points, rule.reason),
      );
    });

    if (leadType.includes('исход') || leadType.includes('outbound')) {
      add(['скрипт продаж'], 8, 'исходящая лидогенерация требует скриптов');
      add(
        ['портрет соискателя'],
        5,
        'для исходящей лидогенерации нужен портрет',
      );
    }
    if (leadType.includes('вход') || leadType.includes('inbound')) {
      add(
        ['интеграция телефонии'],
        stage === 'new_department' ? 10 : 6,
        'входящие обращения нужно фиксировать',
      );
      add(
        ['интеграция мессенджера'],
        stage === 'new_department' ? 10 : 6,
        'входящие переписки нужно фиксировать',
      );
    }

    return rules;
  }

  private normalizeProfile(
    profile: Record<string, unknown>,
  ): NormalizedQuestionnaireProfile {
    const desiredSalesDepartment = this.toArray(profile.desiredSalesDepartment);
    const selectedComponents = this.getSelectedComponents(
      profile.components,
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
    if (this.isPlainObject(profile.desiredResult)) {
      return String(profile.desiredResult.period ?? '');
    }
    return String(profile.period ?? '');
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
    serviceText: string,
    stage: QuestionnaireStage,
    desiredText: string,
    desiredPeriod: string,
  ): string | null {
    if (
      desiredPeriod === '1m' &&
      this.includesAny(serviceText, [
        'на 3 месяца',
        '3 месяца',
        'трехмесяч',
        'трех месяцев',
        'трехмесячный',
      ])
    ) {
      return 'срок услуги не соответствует цели на 1 месяц';
    }

    if (
      stage === 'new_department' &&
      this.includesAny(serviceText, [
        'ии роп',
        'роп-фокус',
        'топ-фокус',
        'руководитель отдела продаж',
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
        'дашборд оп',
        'на контроле',
        'crm серебро',
        'crm золото',
        'стандарт online pro',
        'офис pro',
      ])
    ) {
      return 'услуга рассчитана на более зрелый отдел продаж';
    }

    if (
      stage === 'advanced_department' &&
      this.includesAny(serviceText, [
        'отдел продаж с нуля',
        'crm старт',
        'crm бронза',
        'базовая настройка работы отдела продаж',
        'пакет обучения на месяц',
      ])
    ) {
      return 'услуга слишком базовая для развитого отдела продаж';
    }

    if (
      stage === 'basic_department' &&
      this.includesAny(serviceText, [
        'отдел продаж с нуля',
        'базовая настройка работы отдела продаж',
        'crm серебро',
        'crm золото',
        'ии роп',
        'топ-фокус',
        'коммерческий директор',
        'финансовый директор',
        'hrd',
      ])
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
      this.includesAny(serviceText, [
        'подбор под ключ',
        'скрининг',
        'стандарт online',
        'офис',
        'профиль вакансии',
        'портрет соискателя',
      ])
    ) {
      return 'подбор персонала не выбран в анкете зрелого отдела';
    }

    return null;
  }

  private applyDiversity(
    candidates: GeneratedRecommendationItem[],
    limit: number,
  ): GeneratedRecommendationItem[] {
    const selected: GeneratedRecommendationItem[] = [];
    const skipped: GeneratedRecommendationItem[] = [];
    const groupCounts = new Map<ServiceGroup, number>();

    for (const item of candidates) {
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

  private buildNewDepartmentDefaultRecommendations(
    services: ServiceCandidate[],
    rankedById: Map<
      string,
      { item: GeneratedRecommendationItem; index: number }
    >,
    context: string,
    limit: number,
  ): GeneratedRecommendationItem[] {
    const selected: GeneratedRecommendationItem[] = [];
    const usedTargetIds = new Set<string>();

    for (const rule of NEW_DEPARTMENT_DEFAULT_RULES) {
      const service = services.find((candidate) => {
        if (usedTargetIds.has(this.getCandidateTargetId(candidate)))
          return false;
        const serviceText = this.normalizeCandidateText(candidate);
        return rule.terms.every((term) =>
          serviceText.includes(this.normalize(term)),
        );
      });

      if (!service) continue;

      const targetId = this.getCandidateTargetId(service);
      usedTargetIds.add(targetId);
      const base =
        rankedById.get(targetId)?.item ??
        this.scoringService.scoreService(service, context);

      selected.push({
        ...base,
        serviceId: base.serviceId,
        packageId: base.packageId,
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

  private getServiceGroup(item: GeneratedRecommendationItem): ServiceGroup {
    const text = this.normalize(
      `${item.serviceName} ${item.diagnosticSignals.join(' ')}`,
    );

    if (text.includes('crm')) return 'crm';
    if (this.includesAny(text, ['телефони', 'мессенджер', 'звонк'])) {
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

  private normalizeCandidateText(service: ServiceCandidate): string {
    return this.normalize(
      [
        service.name,
        service.description,
        service.category?.name,
        service.type,
        ...(service.skills ?? []),
      ].join(' '),
    );
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
