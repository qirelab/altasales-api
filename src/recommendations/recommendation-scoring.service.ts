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
  recommendation?: Recommendation;
};

type AiRecommendationCandidate = {
  serviceId: string;
  priority?: RecommendationPriority | string;
  rationale?: string;
  diagnosticSignals?: string[];
};

const MAX_CATALOG_FOR_LLM = 50;
const AI_RECOMMENDATION_CACHE_TTL_MS = 60 * 60 * 1000;

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
    };
  }

  async generateAiRecommendations(
    dto: GenerateRecommendationsDto,
    services: ServiceCandidate[],
    context: string,
  ): Promise<GeneratedRecommendationItem[]> {
    if (!context) return [];

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
            content:
              'Ты AI-движок рекомендаций AltaSales. Выбирай только релевантные serviceId из каталога, не возвращай весь каталог. Если релевантный пакет уже покрывает отдельную услугу или документ из своего состава, рекомендуй пакет и не дублируй вложенную сущность отдельной рекомендацией. Обоснование пиши на русском. Верни только валидный JSON.',
          },
          {
            role: 'user',
            content: JSON.stringify({
              instruction:
                'Верни {"recommendations":[{"serviceId":"...","priority":"urgent|medium|low","rationale":"короткое обоснование на русском","diagnosticSignals":["signal"]}]}. Возвращай только реально релевантные рекомендации. Не возвращай отдельные услуги, если выбранный пакет уже содержит или логически покрывает их результат.',
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

      for (const item of parsed) {
        const service = servicesById.get(item.serviceId);
        const targetId = service ? this.getCandidateTargetId(service) : null;
        if (!service || !targetId || usedTargetIds.has(targetId)) continue;

        usedTargetIds.add(targetId);
        const fallback = this.scoreService(service, context);
        if (fallback.score <= 0) continue;

        const priority =
          this.normalizePriority(item.priority) ?? fallback.priority;
        const diagnosticSignals = this.normalizeSignals([
          'ai_generated',
          ...(item.diagnosticSignals ?? fallback.diagnosticSignals),
        ]);

        result.push({
          serviceId: fallback.serviceId,
          packageId: fallback.packageId,
          serviceName: service.name,
          priority,
          rationale: this.resolveRussianRationale(
            item.rationale,
            fallback.rationale,
            service.name,
          ),
          diagnosticSignals,
          score: fallback.score,
          coveredServiceIds: fallback.coveredServiceIds,
        });
      }

      return result.sort(
        (a, b) =>
          b.score - a.score ||
          this.scorePriority(b.priority) - this.scorePriority(a.priority),
      );
    } catch (error) {
      this.logger.warn({
        eventName: 'AI_RECOMMENDATION_GENERATION_FAILED',
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return [];
    }
  }

  parseAiRecommendationResponse(content: string): AiRecommendationCandidate[] {
    let parsed: { recommendations?: AiRecommendationCandidate[] };

    try {
      parsed = JSON.parse(this.extractJson(content)) as {
        recommendations?: AiRecommendationCandidate[];
      };
    } catch (error) {
      throw new Error(
        `Invalid AI recommendation JSON: ${
          error instanceof Error ? error.message : 'Unknown parse error'
        }`,
      );
    }

    if (!Array.isArray(parsed.recommendations)) return [];
    return parsed.recommendations.filter(
      (item) => item && typeof item.serviceId === 'string',
    );
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
      new Set(signals.map((s) => s.trim()).filter((s) => s.length > 0)),
    );
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

  private resolveRussianRationale(
    aiRationale: string | undefined,
    fallbackRationale: string,
    serviceName: string,
  ): string {
    const trimmed = aiRationale?.trim();
    if (trimmed && /[а-яё]/i.test(trimmed)) {
      return trimmed;
    }

    return (
      fallbackRationale || `${serviceName} подходит по результатам диагностики.`
    );
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
