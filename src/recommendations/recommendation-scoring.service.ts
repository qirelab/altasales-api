import { Injectable, Logger } from '@nestjs/common';
import { AgentId } from '../ai/enums/agent-id.enum';
import { LlmTask } from '../ai/enums/llm-task.enum';
import { LlmProxyService } from '../ai/llm-proxy.service';
import { ServicePackage } from '../packages/entities/package.entity';
import { Service } from '../services/entities/service.entity';
import { GenerateRecommendationsDto } from './dto/generate-recommendations.dto';
import { RecommendationPriority } from './entities/recommendation-priority.enum';
import { Recommendation } from './entities/recommendation.entity';
import { SIGNAL_GROUPS } from './signal-groups.config';

export type ServiceCandidate = Service & {
  category?: { name?: string } | null;
};

export type PackageCandidate = ServicePackage & {
  category?: { name?: string } | null;
  services?: ServiceCandidate[];
};

export type RecommendationTargetCandidate = {
  id: string;
  targetType: 'service' | 'package';
  serviceId: string | null;
  packageId: string | null;
  name: string;
  description: string;
  category: string | null;
  price: number;
  type?: string;
  skills: string[];
  tags: string[];
  packageType?: string | null;
  services: ServiceCandidate[];
};

export type GeneratedRecommendationItem = {
  serviceId: string | null;
  packageId: string | null;
  serviceName: string;
  targetType: 'service' | 'package';
  priority: RecommendationPriority;
  rationale: string;
  diagnosticSignals: string[];
  score: number;
  recommendation?: Recommendation;
};

type AiRecommendationCandidate = {
  serviceId?: string | null;
  packageId?: string | null;
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

  buildCatalogTargets(
    services: ServiceCandidate[],
    packages: PackageCandidate[] = [],
  ): RecommendationTargetCandidate[] {
    return [
      ...packages.map((servicePackage) =>
        this.toPackageTarget(servicePackage),
      ),
      ...services.map((service) => this.toServiceTarget(service)),
    ];
  }

  scoreService(
    service: ServiceCandidate,
    context: string,
  ): GeneratedRecommendationItem {
    return this.scoreCandidate(this.toServiceTarget(service), context);
  }

  scorePackage(
    servicePackage: PackageCandidate,
    context: string,
  ): GeneratedRecommendationItem {
    return this.scoreCandidate(this.toPackageTarget(servicePackage), context);
  }

  scoreCandidate(
    candidate: RecommendationTargetCandidate,
    context: string,
  ): GeneratedRecommendationItem {
    const targetText = this.buildCandidateSearchText(candidate);
    const matchedSignals = SIGNAL_GROUPS.filter(
      (group) =>
        group.diagnosticTerms.some((term) =>
          this.includesTerm(context, term),
        ) &&
        group.serviceTerms.some((term) => this.includesTerm(targetText, term)),
    );
    const score = matchedSignals.reduce((sum, group) => sum + group.weight, 0);
    const priority = this.resolvePriority(score, matchedSignals);

    return {
      serviceId: candidate.serviceId,
      packageId: candidate.packageId,
      serviceName: candidate.name,
      targetType: candidate.targetType,
      priority,
      rationale: this.buildRationale(candidate.name, priority, matchedSignals),
      diagnosticSignals: matchedSignals.map((group) => group.signal),
      score,
    };
  }

  async generateAiRecommendations(
    dto: GenerateRecommendationsDto,
    candidates: RecommendationTargetCandidate[],
    context: string,
  ): Promise<GeneratedRecommendationItem[]> {
    if (!context) return [];

    try {
      const catalogSlice = this.selectCatalogForLlm(candidates, context);

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
              'You are an AI recommendation engine for AltaSales. Pick relevant services or packages from the provided catalog. Return only valid JSON.',
          },
          {
            role: 'user',
            content: JSON.stringify({
              instruction:
                'Return {"recommendations":[{"serviceId":"..." OR "packageId":"...","priority":"urgent|medium|low","rationale":"short reason","diagnosticSignals":["signal"]}]}. Use packageId when the whole package is a better fit than a single service.',
              clientProfile: dto.clientProfile ?? {},
              diagnostics: dto.diagnostics ?? [],
              catalog: catalogSlice.map((candidate) => ({
                targetType: candidate.targetType,
                serviceId: candidate.serviceId,
                packageId: candidate.packageId,
                name: candidate.name,
                description: candidate.description,
                category: candidate.category,
                type: candidate.type,
                skills: candidate.skills,
                tags: candidate.tags,
                packageType: candidate.packageType,
                includedServices: candidate.services.map((service) => ({
                  name: service.name,
                  description: service.description,
                  category: service.category?.name ?? null,
                  skills: service.skills ?? [],
                })),
              })),
            }),
          },
        ],
      });

      const parsed = this.parseAiRecommendationResponse(response.content);
      const candidatesByKey = new Map(
        candidates.map((candidate) => [
          this.getCandidateKey(candidate),
          candidate,
        ]),
      );
      const result: GeneratedRecommendationItem[] = [];
      const usedTargetKeys = new Set<string>();

      for (const item of parsed) {
        const key = this.getAiCandidateKey(item);
        const candidate = key ? candidatesByKey.get(key) : undefined;
        if (!candidate || usedTargetKeys.has(key!)) continue;

        usedTargetKeys.add(key!);
        const fallback = this.scoreCandidate(candidate, context);
        const priority =
          this.normalizePriority(item.priority) ?? fallback.priority;
        const diagnosticSignals = this.normalizeSignals([
          'ai_generated',
          ...(item.diagnosticSignals ?? fallback.diagnosticSignals),
        ]);

        result.push({
          ...fallback,
          priority,
          rationale:
            item.rationale?.trim() ||
            fallback.rationale ||
            `${candidate.name} was selected by AI based on onboarding diagnostics.`,
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
    return parsed.recommendations.filter((item) => Boolean(this.getAiCandidateKey(item)));
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

  getCandidateKey(candidate: RecommendationTargetCandidate): string {
    return candidate.targetType === 'package'
      ? `package:${candidate.packageId}`
      : `service:${candidate.serviceId}`;
  }

  getRecommendationKey(item: Pick<GeneratedRecommendationItem, 'serviceId' | 'packageId'>): string {
    return item.packageId ? `package:${item.packageId}` : `service:${item.serviceId}`;
  }

  private toServiceTarget(service: ServiceCandidate): RecommendationTargetCandidate {
    return {
      id: service.id,
      targetType: 'service',
      serviceId: service.id,
      packageId: null,
      name: service.name,
      description: service.description,
      category: service.category?.name ?? null,
      price: Number(service.price ?? 0),
      type: service.type,
      skills: service.skills ?? [],
      tags: [],
      packageType: null,
      services: [],
    };
  }

  private toPackageTarget(
    servicePackage: PackageCandidate,
  ): RecommendationTargetCandidate {
    return {
      id: servicePackage.id,
      targetType: 'package',
      serviceId: null,
      packageId: servicePackage.id,
      name: servicePackage.name,
      description: servicePackage.description,
      category: servicePackage.category?.name ?? null,
      price: Number(servicePackage.price ?? 0),
      skills: [],
      tags: servicePackage.tags ?? [],
      packageType: servicePackage.packageType ?? null,
      services: servicePackage.services ?? [],
    };
  }

  private selectCatalogForLlm(
    candidates: RecommendationTargetCandidate[],
    context: string,
  ): RecommendationTargetCandidate[] {
    const scored = candidates.map((candidate, index) => ({
      candidate,
      index,
      score: this.scoreCandidate(candidate, context).score,
    }));
    const hasPositiveScore = scored.some((item) => item.score > 0);

    if (!hasPositiveScore) {
      return this.interleaveCatalogTargets(candidates).slice(0, MAX_CATALOG_FOR_LLM);
    }

    return scored
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return a.index - b.index;
      })
      .slice(0, MAX_CATALOG_FOR_LLM)
      .map((item) => item.candidate);
  }

  private interleaveCatalogTargets(
    candidates: RecommendationTargetCandidate[],
  ): RecommendationTargetCandidate[] {
    const packages = candidates.filter((candidate) => candidate.targetType === 'package');
    const services = candidates.filter((candidate) => candidate.targetType === 'service');
    const result: RecommendationTargetCandidate[] = [];
    const maxLength = Math.max(packages.length, services.length);

    for (let index = 0; index < maxLength; index += 1) {
      if (packages[index]) result.push(packages[index]);
      if (services[index]) result.push(services[index]);
    }

    return result;
  }

  private buildCandidateSearchText(candidate: RecommendationTargetCandidate): string {
    return this.normalizeText(
      [
        candidate.name,
        candidate.description,
        candidate.category,
        candidate.type,
        candidate.packageType,
        ...candidate.skills,
        ...candidate.tags,
        ...candidate.services.flatMap((service) => [
          service.name,
          service.description,
          service.category?.name,
          ...(service.skills ?? []),
        ]),
      ].join(' '),
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

  private getAiCandidateKey(item: AiRecommendationCandidate): string | null {
    if (typeof item.packageId === 'string' && item.packageId.length > 0) {
      return `package:${item.packageId}`;
    }
    if (typeof item.serviceId === 'string' && item.serviceId.length > 0) {
      return `service:${item.serviceId}`;
    }
    return null;
  }
}
