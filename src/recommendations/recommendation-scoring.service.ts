import { Injectable, Logger } from '@nestjs/common';
import { AgentId } from '../ai/enums/agent-id.enum';
import { LlmTask } from '../ai/enums/llm-task.enum';
import { LlmProxyService } from '../ai/llm-proxy.service';
import { Service } from '../services/entities/service.entity';
import { GenerateRecommendationsDto } from './dto/generate-recommendations.dto';
import { RecommendationPriority } from './entities/recommendation-priority.enum';
import { Recommendation } from './entities/recommendation.entity';
import { SIGNAL_GROUPS } from './signal-groups.config';

export type ServiceCandidate = Service & {
  category?: { name?: string } | null;
};

export type GeneratedRecommendationItem = {
  serviceId: string;
  serviceName: string;
  priority: RecommendationPriority;
  rationale: string;
  diagnosticSignals: string[];
  score: number;
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

    return {
      serviceId: service.id,
      serviceName: service.name,
      priority,
      rationale: this.buildRationale(service.name, priority, matchedSignals),
      diagnosticSignals: matchedSignals.map((group) => group.signal),
      score,
    };
  }

  async generateAiRecommendations(
    dto: GenerateRecommendationsDto,
    services: ServiceCandidate[],
    context: string,
  ): Promise<GeneratedRecommendationItem[]> {
    if (!context) return [];

    try {
      const catalogSlice = services.slice(0, MAX_CATALOG_FOR_LLM);

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
              'You are an AI recommendation engine for AltaSales. Pick relevant service IDs from the provided catalog. Return only valid JSON.',
          },
          {
            role: 'user',
            content: JSON.stringify({
              instruction:
                'Return {"recommendations":[{"serviceId":"...","priority":"urgent|medium|low","rationale":"short reason","diagnosticSignals":["signal"]}]}',
              clientProfile: dto.clientProfile ?? {},
              diagnostics: dto.diagnostics ?? [],
              catalog: catalogSlice.map((service) => ({
                serviceId: service.id,
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
      const servicesById = new Map(services.map((s) => [s.id, s]));
      const result: GeneratedRecommendationItem[] = [];
      const usedServiceIds = new Set<string>();

      for (const item of parsed) {
        const service = servicesById.get(item.serviceId);
        if (!service || usedServiceIds.has(service.id)) continue;

        usedServiceIds.add(service.id);
        const fallback = this.scoreService(service, context);
        const priority =
          this.normalizePriority(item.priority) ?? fallback.priority;
        const diagnosticSignals = this.normalizeSignals([
          'ai_generated',
          ...(item.diagnosticSignals ?? fallback.diagnosticSignals),
        ]);

        result.push({
          serviceId: service.id,
          serviceName: service.name,
          priority,
          rationale:
            item.rationale?.trim() ||
            fallback.rationale ||
            `${service.name} was selected by AI based on onboarding diagnostics.`,
          diagnosticSignals,
          score:
            fallback.score > 0 ? fallback.score : this.scorePriority(priority),
        });
      }

      return result;
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
      .replace(/ё/g, 'е')
      .replace(/[^\p{L}\p{N}_]+/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  normalizeSignals(signals: string[]): string[] {
    return Array.from(
      new Set(signals.map((s) => s.trim()).filter((s) => s.length > 0)),
    );
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
    // Prefix matching is limited to longer stems to avoid noisy short-token hits.
    return textTokens.some(
      (token) =>
        token === singleTerm ||
        (singleTerm.length >= 5 && token.startsWith(singleTerm)),
    );
  }

  private buildRationale(
    serviceName: string,
    priority: RecommendationPriority,
    matchedSignals: { signal: string; title?: string }[],
  ): string {
    const signalText = matchedSignals
      .map((group) => group.title ?? group.signal)
      .join(', ');
    return `${serviceName} matched diagnostics (${signalText || 'general fit'}) with ${priority} urgency.`;
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
