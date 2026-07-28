import { Injectable, Logger } from '@nestjs/common';
import { AgentId } from '../ai/enums/agent-id.enum';
import { LlmTask } from '../ai/enums/llm-task.enum';
import { LlmProxyService } from '../ai/llm-proxy.service';
import { Service } from '../services/entities/service.entity';
import { ServiceType } from '../services/entities/service-type.enum';
import { GenerateRecommendationsDto } from './dto/generate-recommendations.dto';
import { RecommendationPriority } from './entities/recommendation-priority.enum';
import { Recommendation } from './entities/recommendation.entity';
import { SIGNAL_GROUPS } from './signal-groups.config';

export type ServiceCandidate = Omit<Service, 'type'> & {
  category?: { name?: string } | null;
  serviceId?: string | null;
  packageId?: string | null;
  type: ServiceType | 'Пакет услуг';
  coveredServiceIds?: string[];
  coverageKeys?: string[];
};

export type GeneratedRecommendationItem = {
  serviceId: string | null;
  packageId?: string | null;
  serviceName: string;
  priority: RecommendationPriority;
  rationale: string;
  diagnosticSignals: string[];
  score: number;
  coveredServiceIds?: string[];
  coverageKeys?: string[];
  recommendation?: Recommendation;
};

export type GeneratedRecommendationsResult = {
  summary: string;
  recommendations: GeneratedRecommendationItem[];
};

type AiRecommendationCandidate = {
  serviceId: string;
  priority?: RecommendationPriority | string;
  rationale?: string;
  diagnosticSignals?: string[];
};

type AiRecommendationResponse = {
  summary?: string;
  recommendations: AiRecommendationCandidate[];
};

const MAX_CATALOG_FOR_LLM = 500;
const AI_RECOMMENDATION_CACHE_TTL_MS = 60 * 60 * 1000;
const AI_SEMANTIC_RECOMMENDATION_SCORE = 6;
const MIN_AI_EVIDENCE_TOKEN_LENGTH = 4;
const MAX_RECOMMENDATION_SUMMARY_LENGTH = 1000;
const SUMMARY_PRIORITY_LANGUAGE_PATTERN =
  /\bpriority\b|приоритет\p{L}*|срочн\p{L}*|первоочередн\p{L}*|в\s+первую\s+очередь/iu;
const AI_RECOMMENDATIONS_RESPONSE_EXAMPLE =
  '{"summary":"общий вводный текст","recommendations":[' +
  '{"serviceId":"...","priority":"urgent|medium|low",' +
  '"rationale":"короткое обоснование на русском",' +
  '"diagnosticSignals":["signal"]}]}';
const NEW_SALES_DEPARTMENT_PREAMBLE = [
  'На основании заполненной анкеты AI сформировал проект вашего отдела продаж.',
  'В него вошли инструменты, документы, специалисты и AI-модули,',
  'которые необходимы для достижения ваших целей.',
  'Каждая рекомендация основана на параметрах вашего бизнеса',
  'и может быть подключена прямо из платформы.',
].join(' ');
const EXISTING_SALES_DEPARTMENT_PREAMBLE = [
  'На основании ваших ответов AI проанализировал текущую организацию отдела продаж',
  'и определил, какие изменения помогут повысить его эффективность.',
  'Ниже представлены решения, которые рекомендуется внедрить именно вашей компании.',
  'Каждая рекомендация направлена на устранение выявленных ограничений,',
  'автоматизацию процессов и достижение поставленных бизнес-целей.',
].join(' ');
const AI_RECOMMENDATIONS_SYSTEM_PROMPT = [
  'Ты AI-движок рекомендаций AltaSales.',
  'Выбирай только релевантные serviceId из каталога, не возвращай весь каталог.',
  'Если релевантный пакет уже покрывает отдельную услугу или документ из своего состава,',
  'рекомендуй пакет и не дублируй вложенную сущность отдельной рекомендацией.',
  'Не придумывай диагнозы, метрики, цифры или проблемы,',
  'которых нет в clientProfile или diagnostics.',
  'Обоснования и общее описание пиши на русском.',
  'Общее описание должно соответствовать тому же набору рекомендаций',
  'и не упоминать инструменты, которых нет в recommendations.',
  'Не говори в общем описании о priority, приоритетности или срочности позиций.',
  'Если передан summaryPreamble, верни его в поле summary дословно и не дополняй.',
  'Верни только валидный JSON.',
].join(' ');
const AI_RECOMMENDATIONS_INSTRUCTION = [
  `Верни ${AI_RECOMMENDATIONS_RESPONSE_EXAMPLE}.`,
  'summary — один связный абзац на русском из 2–4 предложений',
  'без Markdown, списков и заголовков.',
  'Объясни, какие инструменты рекомендуются и почему,',
  'опираясь только на clientProfile и diagnostics.',
  'Тон: «В соответствии с предоставленной вами информацией',
  'специализированный AI-ассистент считает...».',
  'Не упоминай в summary поле priority, уровни приоритета, срочность,',
  'очередность или то, что какая-либо позиция важнее другой.',
  'Если данных мало, прямо опирайся на доступные ответы',
  'и не придумывай конкретные показатели, цифры или факты.',
  'summary должен описывать только позиции из recommendations и не противоречить им.',
  'Возвращай только реально релевантные рекомендации.',
  'Для productStage=existing поле components описывает, что уже есть,',
  'а componentsToAdd — что нужно добавить.',
  'Не предлагай стартовое внедрение того, что уже есть.',
  'Для productStage=new поле components описывает желаемый новый ОП;',
  'пакет «Отдел продаж с нуля» обязателен.',
  'Для productStage=existing пакет «Отдел продаж с нуля» запрещён.',
  'Не возвращай отдельные услуги, если выбранный пакет уже содержит',
  'или логически покрывает их результат.',
  'Если передан summaryPreamble, поле summary должно дословно совпадать с ним.',
  'Не переписывай, не сокращай и не дополняй summaryPreamble.',
].join(' ');
const AI_EVIDENCE_STOP_WORDS = new Set([
  'услуга',
  'услуги',
  'услуг',
  'подходит',
  'клиент',
  'клиента',
  'клиентом',
  'сценарий',
  'описанный',
  'формат',
  'работа',
  'работы',
  'решение',
  'решения',
  'документ',
  'документы',
  'пакет',
  'настройка',
  'настройки',
  'business',
  'client',
  'service',
  'solution',
]);

@Injectable()
export class RecommendationScoringService {
  private readonly logger = new Logger(RecommendationScoringService.name);

  constructor(private readonly llmProxy: LlmProxyService) {}

  scoreService(
    service: ServiceCandidate,
    context: string,
  ): GeneratedRecommendationItem {
    const serviceText = this.normalizeText(
      [
        service.name,
        service.description,
        service.category?.name,
        ...(service.skills ?? []),
      ].join(' '),
    );

    const matchedSignals = SIGNAL_GROUPS.filter(
      (group) =>
        group.diagnosticTerms.some((term) =>
          this.includesTerm(context, term),
        ) &&
        group.serviceTerms.some((term) => this.includesTerm(serviceText, term)),
    );
    const score = matchedSignals.reduce((sum, group) => sum + group.weight, 0);
    const priority = this.resolvePriority(score, matchedSignals);
    const serviceId = this.getCandidateServiceId(service);

    return {
      serviceId,
      packageId: service.packageId ?? null,
      serviceName: service.name,
      priority,
      rationale: this.buildRationale(service.name, matchedSignals),
      diagnosticSignals: matchedSignals.map((group) => group.signal),
      score,
      coveredServiceIds: this.getCandidateCoveredServiceIds(service, serviceId),
      coverageKeys: this.getCandidateCoverageKeys(service, serviceId),
    };
  }

  async generateAiRecommendations(
    dto: GenerateRecommendationsDto,
    services: ServiceCandidate[],
    context: string,
  ): Promise<GeneratedRecommendationsResult> {
    const summaryPreamble = this.resolveSummaryPreamble(dto);
    if (!context) {
      return {
        summary: this.buildFallbackSummary([], summaryPreamble),
        recommendations: [],
      };
    }

    try {
      const catalogSlice = this.selectCatalogForLlm(services, context);

      const response = await this.llmProxy.chat({
        agentId: AgentId.Recommendations,
        task: LlmTask.Reason,
        policy: {
          cacheTtlMs: AI_RECOMMENDATION_CACHE_TTL_MS,
        },
        messages: [
          {
            role: 'system',
            content: AI_RECOMMENDATIONS_SYSTEM_PROMPT,
          },
          {
            role: 'user',
            content: JSON.stringify({
              instruction: AI_RECOMMENDATIONS_INSTRUCTION,
              summaryPreamble: summaryPreamble ?? null,
              clientProfile: dto.clientProfile ?? {},
              diagnostics: dto.diagnostics ?? [],
              catalog: catalogSlice.map((service) => ({
                serviceId: this.getCandidateTargetId(service),
                name: service.name,
                description: service.description,
                category: service.category?.name ?? null,
                type: service.type,
                skills: service.skills ?? [],
              })),
            }),
          },
        ],
      });

      const parsed = this.parseAiRecommendationResponse(response.content);
      const servicesById = new Map(
        catalogSlice.map((service) => [
          this.getCandidateTargetId(service),
          service,
        ]),
      );
      const result: GeneratedRecommendationItem[] = [];
      const usedTargetIds = new Set<string>();

      for (const item of parsed.recommendations) {
        const service = servicesById.get(item.serviceId);
        const targetId = service ? this.getCandidateTargetId(service) : null;
        if (!service || !targetId || usedTargetIds.has(targetId)) continue;

        usedTargetIds.add(targetId);
        const fallback = this.scoreService(service, context);
        const aiOnlyCandidate = fallback.score <= 0;
        if (
          aiOnlyCandidate &&
          !this.hasAiOnlyRecommendationEvidence(
            service,
            context,
            item.rationale,
          )
        ) {
          continue;
        }

        const priority =
          this.normalizePriority(item.priority) ?? fallback.priority;
        const diagnosticSignals = this.normalizeSignals([
          'ai_generated',
          ...(aiOnlyCandidate ? ['ai_semantic_match'] : []),
          ...fallback.diagnosticSignals,
        ]);
        const score = aiOnlyCandidate
          ? AI_SEMANTIC_RECOMMENDATION_SCORE
          : fallback.score;

        result.push({
          serviceId: fallback.serviceId,
          packageId: fallback.packageId,
          serviceName: service.name,
          priority,
          rationale: aiOnlyCandidate
            ? `${service.name}: рекомендация соответствует явно указанным ответам анкеты.`
            : fallback.rationale,
          diagnosticSignals,
          score,
          coveredServiceIds: fallback.coveredServiceIds,
          coverageKeys: fallback.coverageKeys,
        });
      }

      const recommendations = result.sort(
        (a, b) =>
          b.score - a.score ||
          this.scorePriority(b.priority) - this.scorePriority(a.priority),
      );

      return {
        summary: this.normalizeSummary(
          parsed.summary,
          recommendations,
          context,
          summaryPreamble,
        ),
        recommendations,
      };
    } catch (error) {
      this.logger.warn({
        eventName: 'AI_RECOMMENDATION_GENERATION_FAILED',
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return {
        summary: this.buildFallbackSummary([], summaryPreamble),
        recommendations: [],
      };
    }
  }

  parseAiRecommendationResponse(content: string): AiRecommendationResponse {
    let parsed: {
      summary?: unknown;
      recommendations?: AiRecommendationCandidate[];
    };

    try {
      parsed = JSON.parse(this.extractJson(content)) as {
        summary?: unknown;
        recommendations?: AiRecommendationCandidate[];
      };
    } catch (error) {
      throw new Error(
        `Invalid AI recommendation JSON: ${
          error instanceof Error ? error.message : 'Unknown parse error'
        }`,
      );
    }

    let recommendations: AiRecommendationCandidate[] = [];
    if (Array.isArray(parsed.recommendations)) {
      recommendations = parsed.recommendations.filter((item) =>
        this.isValidAiRecommendationCandidate(item),
      );
    }

    return {
      summary: typeof parsed.summary === 'string' ? parsed.summary : undefined,
      recommendations,
    };
  }

  resolvePriority(
    score: number,
    matchedSignals: { priority: RecommendationPriority }[],
  ): RecommendationPriority {
    if (
      score >= 7 ||
      matchedSignals.some((s) => s.priority === RecommendationPriority.Urgent)
    ) {
      return RecommendationPriority.Urgent;
    }
    if (score >= 3) return RecommendationPriority.Medium;
    return RecommendationPriority.Low;
  }

  buildDiagnosticContext(dto: GenerateRecommendationsDto): string {
    return this.normalizeText(
      [
        JSON.stringify(dto.clientProfile ?? {}),
        ...(dto.diagnostics ?? []),
      ].join(' '),
    );
  }

  normalizeText(text: string): string {
    return text
      .normalize('NFKC')
      .toLowerCase()
      .replace(/\u0451/g, '\u0435')
      .replace(/[^\p{L}\p{N}_]+/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  normalizeSignals(signals: string[]): string[] {
    return Array.from(
      new Set(
        signals
          .filter((s): s is string => typeof s === 'string')
          .map((s) => s.trim())
          .filter((s) => s.length > 0),
      ),
    );
  }

  private isValidAiRecommendationCandidate(
    item: AiRecommendationCandidate,
  ): boolean {
    return Boolean(
      item &&
      typeof item.serviceId === 'string' &&
      (item.priority === undefined || typeof item.priority === 'string') &&
      (item.rationale === undefined || typeof item.rationale === 'string') &&
      (item.diagnosticSignals === undefined ||
        (Array.isArray(item.diagnosticSignals) &&
          item.diagnosticSignals.every(
            (signal) => typeof signal === 'string',
          ))),
    );
  }

  private normalizeSummary(
    summary: string | undefined,
    recommendations: GeneratedRecommendationItem[],
    context: string,
    summaryPreamble?: string,
  ): string {
    const fallback = this.buildFallbackSummary(
      recommendations,
      summaryPreamble,
    );
    if (recommendations.length === 0) return fallback;
    if (summaryPreamble) return summaryPreamble;
    if (!summary?.trim()) return fallback;

    const normalized = summary
      .replace(/```(?:\w+)?/g, ' ')
      .replace(/\[([^\]]+)]\([^)]+\)/g, '$1')
      .replace(/<[^>]+>/g, ' ')
      .replace(/^\s{0,3}(?:#{1,6}|[-+])\s+/gm, '')
      .replace(/[*_`~]/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    const sentences = normalized
      .split(/(?<=[.!?])\s+(?=[А-ЯЁA-Z«])/u)
      .map((sentence) => sentence.trim())
      .filter(Boolean);
    if (
      normalized.length > MAX_RECOMMENDATION_SUMMARY_LENGTH ||
      sentences.length < 2 ||
      sentences.length > 4 ||
      !this.hasRussianText(normalized) ||
      SUMMARY_PRIORITY_LANGUAGE_PATTERN.test(normalized) ||
      this.hasUnsupportedSummaryNumbers(normalized, recommendations, context)
    ) {
      return fallback;
    }

    const plainText = sentences.join(' ');
    return /[.!?]$/.test(plainText) ? plainText : `${plainText}.`;
  }

  private hasUnsupportedSummaryNumbers(
    summary: string,
    recommendations: GeneratedRecommendationItem[],
    context: string,
  ): boolean {
    const supportedNumbers = new Set(
      [
        context,
        ...recommendations.map((recommendation) => recommendation.serviceName),
      ]
        .join(' ')
        .match(/\d+/g) ?? [],
    );
    const summaryNumbers = summary.match(/\d+/g) ?? [];
    return summaryNumbers.some((number) => !supportedNumbers.has(number));
  }

  private buildFallbackSummary(
    recommendations: GeneratedRecommendationItem[],
    summaryPreamble?: string,
  ): string {
    if (summaryPreamble && recommendations.length > 0) return summaryPreamble;

    const recommendationNames = recommendations
      .slice(0, 4)
      .map((recommendation) =>
        recommendation.serviceName
          .replace(/[\r\n.!?*_`~]+/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 100),
      )
      .filter(Boolean)
      .map((name) => `«${name}»`);

    if (recommendationNames.length === 0) {
      return [
        'В соответствии с предоставленной вами информацией',
        'специализированный AI-ассистент оценил доступные ответы анкеты,',
        'чтобы подобрать подходящие инструменты для отдела продаж.',
        'Данных пока недостаточно для конкретных выводов,',
        'поэтому по мере уточнения задач и процессов',
        'набор рекомендаций может быть дополнен.',
      ].join(' ');
    }

    const lastName = recommendationNames.at(-1);
    const formattedNames =
      recommendationNames.length === 1
        ? recommendationNames[0]
        : `${recommendationNames.slice(0, -1).join(', ')} и ${lastName}`;

    const introduction = [
      'В соответствии с предоставленной вами информацией',
      'специализированный AI-ассистент рекомендует обратить внимание на',
      formattedNames,
    ].join(' ');
    return [
      `${introduction}.`,
      'Эти инструменты подобраны с учётом указанных в анкете задач',
      'и текущего состояния процессов продаж,',
      'без предположений о данных, которых вы не предоставляли.',
    ].join(' ');
  }

  private resolveSummaryPreamble(
    dto: GenerateRecommendationsDto,
  ): string | undefined {
    const clientProfile = dto.clientProfile ?? {};
    const productStage = this.normalizeText(
      String(clientProfile.productStage ?? ''),
    );
    const profileText = this.normalizeText(JSON.stringify(clientProfile));
    const explicitlyNeedsDepartmentFromZero = [
      'отдел продаж с нуля',
      'отсутствует отдел продаж',
      'нет отдела продаж',
      'построить отдел продаж',
    ].some((marker) => profileText.includes(marker));

    if (
      productStage === 'new' ||
      productStage.includes('новый') ||
      explicitlyNeedsDepartmentFromZero
    ) {
      return NEW_SALES_DEPARTMENT_PREAMBLE;
    }

    if (
      productStage === 'existing' ||
      productStage.includes('уже продаю') ||
      productStage.includes('существующ')
    ) {
      return EXISTING_SALES_DEPARTMENT_PREAMBLE;
    }

    return undefined;
  }

  private selectCatalogForLlm(
    services: ServiceCandidate[],
    context: string,
  ): ServiceCandidate[] {
    const scored = services.map((service, index) => ({
      service,
      index,
      score: this.scoreService(service, context).score,
    }));
    const hasPositiveScore = scored.some((item) => item.score > 0);

    if (!hasPositiveScore) {
      return services.slice(0, MAX_CATALOG_FOR_LLM);
    }

    return scored
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return a.index - b.index;
      })
      .slice(0, MAX_CATALOG_FOR_LLM)
      .map((item) => item.service);
  }

  private getCandidateTargetId(service: ServiceCandidate): string {
    return service.packageId ?? service.serviceId ?? service.id;
  }

  private getCandidateServiceId(service: ServiceCandidate): string | null {
    if (service.packageId) return null;
    return service.serviceId ?? service.id;
  }

  private getCandidateCoveredServiceIds(
    service: ServiceCandidate,
    serviceId: string | null,
  ): string[] {
    if (service.coveredServiceIds?.length) {
      return service.coveredServiceIds;
    }
    return serviceId ? [serviceId] : [];
  }

  private getCandidateCoverageKeys(
    service: ServiceCandidate,
    serviceId: string | null,
  ): string[] {
    if (service.coverageKeys?.length) return service.coverageKeys;
    if (service.coveredServiceIds?.length) return service.coveredServiceIds;
    return serviceId ? [serviceId] : [];
  }

  private includesTerm(normalizedText: string, term: string): boolean {
    const normalizedTerm = this.normalizeText(term);
    if (!normalizedTerm) return false;

    const textTokens = normalizedText.split(' ').filter(Boolean);
    const termTokens = normalizedTerm.split(' ').filter(Boolean);
    if (termTokens.length > 1) {
      return normalizedText
        .split(' ')
        .some((_, index, tokens) =>
          termTokens.every((token, offset) => tokens[index + offset] === token),
        );
    }

    const [singleTerm] = termTokens;
    return textTokens.some(
      (token) =>
        token === singleTerm ||
        (singleTerm.length >= 5 && token.startsWith(singleTerm)),
    );
  }

  private buildRationale(
    serviceName: string,
    matchedSignals: { signal: string; title?: string }[],
  ): string {
    const signalText = matchedSignals
      .map((group) => this.getSignalLabel(group.signal))
      .join(', ');
    return `${serviceName} подходит по результатам диагностики: ${signalText || 'общее соответствие запросу'}.`;
  }

  private hasRussianText(value: string | undefined): boolean {
    return Boolean(value?.trim() && /[а-яё]/i.test(value));
  }

  private hasAiOnlyRecommendationEvidence(
    service: ServiceCandidate,
    context: string,
    aiRationale: string | undefined,
  ): boolean {
    if (!this.hasRussianText(aiRationale)) return false;

    const serviceTokens = this.getMeaningfulEvidenceTokens(
      this.normalizeText(
        [
          service.name,
          service.description,
          service.category?.name,
          ...(service.skills ?? []),
        ].join(' '),
      ),
    );
    const evidenceTokens = this.getMeaningfulEvidenceTokens(
      this.normalizeText(context),
    );

    return serviceTokens.some((serviceToken) =>
      evidenceTokens.some((evidenceToken) =>
        this.isSameEvidenceToken(serviceToken, evidenceToken),
      ),
    );
  }

  private getMeaningfulEvidenceTokens(normalizedText: string): string[] {
    return normalizedText
      .split(' ')
      .filter(
        (token) =>
          token.length >= MIN_AI_EVIDENCE_TOKEN_LENGTH &&
          !AI_EVIDENCE_STOP_WORDS.has(token),
      );
  }

  private isSameEvidenceToken(left: string, right: string): boolean {
    if (left === right) return true;
    if (
      left.length >= MIN_AI_EVIDENCE_TOKEN_LENGTH + 2 &&
      right.length >= MIN_AI_EVIDENCE_TOKEN_LENGTH + 2
    ) {
      return left.startsWith(right) || right.startsWith(left);
    }
    return false;
  }

  private getSignalLabel(signal: string): string {
    const labels: Record<string, string> = {
      revenue_risk: 'риск по выручке',
      funnel_conversion: 'просадка конверсии воронки',
      lead_generation_gap: 'нехватка лидогенерации',
      analytics_visibility: 'недостаток аналитики продаж',
      crm_quality: 'качество данных в CRM',
      retention_growth: 'удержание и повторные продажи',
      unit_economics: 'давление на юнит-экономику',
      team_performance: 'эффективность команды продаж',
      sales_process: 'невыстроенный процесс продаж',
    };

    return labels[signal] ?? signal;
  }

  private extractJson(content: string): string {
    const trimmed = content.trim();
    if (trimmed.startsWith('{')) return trimmed;
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) {
      throw new Error('AI recommendation response is not JSON');
    }
    return trimmed.slice(start, end + 1);
  }

  private normalizePriority(
    priority: RecommendationPriority | string | undefined,
  ): RecommendationPriority | undefined {
    if (!priority) return undefined;
    if (
      Object.values(RecommendationPriority).includes(
        priority as RecommendationPriority,
      )
    ) {
      return priority as RecommendationPriority;
    }
    return undefined;
  }

  private scorePriority(priority: RecommendationPriority): number {
    if (priority === RecommendationPriority.Urgent) return 7;
    if (priority === RecommendationPriority.Medium) return 3;
    return 1;
  }
}
