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

@Injectable()
export class QuestionnaireRelevanceRankerService {
  constructor(private readonly scoringService: RecommendationScoringService) {}

  rankRecommendations(
    dto: GenerateRecommendationsDto,
    services: ServiceCandidate[],
    ranked: GeneratedRecommendationItem[],
    context: string,
    limit = 5,
  ): GeneratedRecommendationItem[] {
    const profile = dto.clientProfile ?? {};
    const stage = this.detectStage(profile);
    const rules = this.buildRules(profile, stage);
    const desiredText = this.normalize(
      JSON.stringify(profile.desiredSalesDepartment ?? []),
    );
    const rankedById = new Map(
      ranked.map((item, index) => [item.serviceId, { item, index }]),
    );

    if (stage === 'new_department') {
      const defaultItems = this.buildNewDepartmentDefaultRecommendations(
        services,
        rankedById,
        context,
        limit,
      );

      if (defaultItems.length >= limit) {
        return this.normalizePriorities(defaultItems);
      }
    }

    const rankedCandidates: GeneratedRecommendationItem[] = [];

    for (const service of services) {
      const serviceText = this.normalizeCandidateText(service);
      if (this.getAntiRecommendationReason(serviceText, stage, desiredText)) {
        continue;
      }

      const fromRanked = rankedById.get(service.id);
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
        priority: base.priority,
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
      limit,
    );

    return this.normalizePriorities(diverse);
  }

  private detectStage(profile: Record<string, unknown>): QuestionnaireStage {
    const text = this.normalize(JSON.stringify(profile ?? {}));
    const desired = this.normalize(
      JSON.stringify(profile.desiredSalesDepartment ?? []),
    );
    const managersCount = Number(profile.calculatedManagersCount || 0);
    const desiredRevenue = Number(profile.desiredRevenue || 0);

    if (
      this.includesAny(text, [
        'новый',
        'построить отдел продаж',
        'с нуля',
      ])
    ) {
      return 'new_department';
    }

    if (
      managersCount >= 5 ||
      desiredRevenue >= 10000000 ||
      this.includesAny(desired, ['роп', 'бизнес тренер'])
    ) {
      return 'advanced_department';
    }

    return 'basic_department';
  }

  private buildRules(
    profile: Record<string, unknown>,
    stage: QuestionnaireStage,
  ): RelevanceRule[] {
    const rules: RelevanceRule[] = [];
    const desired = this.normalize(
      JSON.stringify(profile.desiredSalesDepartment ?? []),
    );
    const leadType = this.normalize(String(profile.leadGenerationType ?? ''));
    const add = (terms: string[], points: number, reason: string): void => {
      rules.push({ terms, points, reason });
    };

    if (stage === 'new_department') {
      add(['отдел продаж с нуля'], 36, 'клиент строит отдел продаж с нуля');
      add(['базовая'], 32, 'нужна базовая настройка отдела');
      add(['crm старт'], 22, 'нужен стартовый CRM-контур');
      add(['пакет документов', 'отдел продаж'], 18, 'нужны базовые документы отдела');
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
      add(['дашборд оп'], 26, 'развитому отделу нужна управленческая аналитика');
      add(['ии роп'], 24, 'нужно управлять командой по данным');
      add(['на контроле'], 22, 'нужен контроль качества коммуникаций');
      add(['crm серебро'], 18, 'нужна расширенная CRM-настройка');
      add(['руководитель отдела продаж'], 18, 'нужно усиление управления продажами');
      add(['роп-фокус'], 16, 'нужно усиление роли РОПа');
    }

    if (desired.includes('crm')) {
      add(
        [
          stage === 'new_department'
            ? 'crm старт'
            : stage === 'advanced_department'
              ? 'crm серебро'
              : 'crm бронза',
        ],
        10,
        'CRM выбрана в анкете',
      );
      add(['технического задания'], 6, 'CRM выбрана в анкете');
    }
    if (desired.includes('телефония')) {
      add(
        ['интеграция телефонии'],
        stage === 'new_department' ? 20 : 12,
        'телефония выбрана в анкете',
      );
    }
    if (desired.includes('мессенджер')) {
      add(
        ['интеграция мессенджера'],
        stage === 'new_department' ? 20 : 12,
        'мессенджер выбран в анкете',
      );
    }
    if (desired.includes('чат бот') || desired.includes('чат-бот')) {
      add(['робот'], 9, 'чат-бот выбран в анкете');
    }
    if (desired.includes('база контактов')) {
      add(['баз контактов'], 9, 'база контактов выбрана в анкете');
    }
    if (desired.includes('менеджер по продажам')) {
      add(
        ['подбор', 'ключ'],
        stage === 'new_department' ? 22 : 12,
        'нужен менеджер по продажам',
      );
      add(['профиль вакансии'], 8, 'нужно описать профиль кандидата');
    }
    if (desired.includes('скрипт')) {
      add(['скрипт продаж'], 12, 'скрипты выбраны в анкете');
    }
    if (desired.includes('аналитик')) {
      add(['дашборд оп'], 12, 'аналитика выбрана в анкете');
      add(['отказ'], 8, 'нужно разбирать потери сделок');
    }
    if (desired.includes('анализ звонков')) {
      add(['на контроле'], 12, 'анализ звонков выбран в анкете');
      add(['отчет', 'звонков'], 10, 'нужно оценивать звонки');
    }
    if (desired.includes('система обучения')) {
      add(['план тренингов'], 12, 'система обучения выбрана в анкете');
      add(['тренинг'], 10, 'нужно развивать навыки менеджеров');
      add(['адаптации моп'], 8, 'нужна адаптация менеджеров');
    }
    if (desired.includes('роп')) {
      add(['роп-фокус'], 14, 'РОП выбран в анкете');
      add(['руководитель отдела продаж'], 10, 'нужно усилить управление отделом');
      add(['ии роп'], 10, 'нужно управлять отделом по данным');
    }

    if (leadType.includes('исход')) {
      add(['скрипт продаж'], 8, 'исходящая лидогенерация требует скриптов');
      add(['портрет соискателя'], 5, 'для исходящей лидогенерации нужен портрет');
    }
    if (leadType.includes('вход')) {
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

  private getAntiRecommendationReason(
    serviceText: string,
    stage: QuestionnaireStage,
    desiredText: string,
  ): string | null {
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
          (selectedItem) => selectedItem.serviceId === item.serviceId,
        )
      ) {
        selected.push(item);
      }
    }

    return selected;
  }

  private buildNewDepartmentDefaultRecommendations(
    services: ServiceCandidate[],
    rankedById: Map<string, { item: GeneratedRecommendationItem; index: number }>,
    context: string,
    limit: number,
  ): GeneratedRecommendationItem[] {
    const selected: GeneratedRecommendationItem[] = [];
    const usedServiceIds = new Set<string>();

    for (const rule of NEW_DEPARTMENT_DEFAULT_RULES) {
      const service = services.find((candidate) => {
        if (usedServiceIds.has(candidate.id)) return false;
        const serviceText = this.normalizeCandidateText(candidate);
        return rule.terms.every((term) => serviceText.includes(this.normalize(term)));
      });

      if (!service) continue;

      usedServiceIds.add(service.id);
      const base =
        rankedById.get(service.id)?.item ??
        this.scoringService.scoreService(service, context);

      selected.push({
        ...base,
        serviceId: service.id,
        serviceName: service.name,
        rationale: this.buildRationale(service.name, [rule.reason]),
        diagnosticSignals: this.scoringService.normalizeSignals([
          ...(base.diagnosticSignals ?? []),
          'default_new_department',
          rule.reason,
        ]),
        score: Math.max(Number(base.score || 0), rule.score),
      });

      if (selected.length >= limit) break;
    }

    return selected;
  }

  private normalizePriorities(
    items: GeneratedRecommendationItem[],
  ): GeneratedRecommendationItem[] {
    return items.map((item, index) => ({
      ...item,
      priority:
        index === 0
          ? RecommendationPriority.Urgent
          : index <= 2
            ? RecommendationPriority.Medium
            : RecommendationPriority.Low,
    }));
  }

  private getServiceGroup(item: GeneratedRecommendationItem): ServiceGroup {
    const text = this.normalize(`${item.serviceName} ${item.diagnosticSignals.join(' ')}`);

    if (text.includes('crm')) return 'crm';
    if (this.includesAny(text, ['телефони', 'мессенджер', 'звонк'])) {
      return 'communications';
    }
    if (this.includesAny(text, ['скрипт', 'документ', 'регламент', 'инструкц'])) {
      return 'documents';
    }
    if (this.includesAny(text, ['подбор', 'ваканси', 'соискател', 'скрининг'])) {
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
