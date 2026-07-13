import { BadRequestException } from '@nestjs/common';
import { In, Repository } from 'typeorm';
import { Recommendation } from './entities/recommendation.entity';

const MAX_DEPENDENCY_DEPTH = 10;

export async function validateDependencyIds(
  recommendationRepository: Repository<Recommendation>,
  recommendationId: string,
  dependencyIds: string[],
  userId?: string,
): Promise<string[]> {
  const uniqueDependencyIds = uniqueIds(dependencyIds);

  if (uniqueDependencyIds.includes(recommendationId)) {
    throw new BadRequestException('Recommendation cannot depend on itself');
  }

  await ensureDependencyGraphIsValid(
    recommendationRepository,
    uniqueDependencyIds,
    recommendationId,
    userId,
  );

  return uniqueDependencyIds;
}

export async function ensureDependencyGraphIsValid(
  recommendationRepository: Repository<Recommendation>,
  dependencyIds: string[],
  rootRecommendationId?: string,
  userId?: string,
): Promise<void> {
  const uniqueDependencyIds = uniqueIds(dependencyIds);

  if (uniqueDependencyIds.length === 0) return;

  const dependencies = await recommendationRepository.find({
    where: { id: In(uniqueDependencyIds) },
    select: { id: true, userId: true, dependencyIds: true },
  });

  if (dependencies.length !== uniqueDependencyIds.length) {
    throw new BadRequestException('One or more dependency IDs do not exist');
  }

  if (userId && dependencies.some((dependency) => dependency.userId !== userId)) {
    throw new BadRequestException('Dependencies must belong to the same user');
  }

  const cache = new Map(dependencies.map((dependency) => [dependency.id, dependency]));
  const visiting = new Set<string>();
  const visited = new Set<string>();

  const visit = async (id: string, depth: number): Promise<void> => {
    if (depth > MAX_DEPENDENCY_DEPTH) {
      throw new BadRequestException(
        `Recommendation dependency graph exceeds maximum depth of ${MAX_DEPENDENCY_DEPTH}`,
      );
    }
    if (visiting.has(id)) {
      throw new BadRequestException('Recommendation dependency graph cannot contain cycles');
    }
    if (visited.has(id)) return;

    let dependency = cache.get(id);
    if (!dependency) {
      const found = await recommendationRepository.find({
        where: { id: In([id]) },
        select: { id: true, userId: true, dependencyIds: true },
      });
      if (found.length !== 1) {
        throw new BadRequestException('One or more dependency IDs do not exist');
      }
      dependency = found[0];
      cache.set(id, dependency);
    }
    if (userId && dependency.userId !== userId) {
      throw new BadRequestException('Dependencies must belong to the same user');
    }
    if (rootRecommendationId && id === rootRecommendationId) {
      throw new BadRequestException('Recommendation dependency graph cannot contain cycles');
    }

    visiting.add(id);
    for (const childId of uniqueIds(dependency.dependencyIds ?? [])) {
      await visit(childId, depth + 1);
    }
    visiting.delete(id);
    visited.add(id);
  };

  for (const dependency of dependencies) {
    await visit(dependency.id, 1);
  }
}

function uniqueIds(ids: string[]): string[] {
  return Array.from(new Set(ids));
}