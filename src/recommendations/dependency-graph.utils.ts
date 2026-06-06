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

  if (!rootRecommendationId) return;

  const visited = new Set<string>();
  let frontier = dependencies.flatMap(
    (dependency) => dependency.dependencyIds ?? [],
  );
  let depth = 0;

  while (frontier.length > 0) {
    depth++;
    if (depth > MAX_DEPENDENCY_DEPTH) {
      throw new BadRequestException(
        `Recommendation dependency graph exceeds maximum depth of ${MAX_DEPENDENCY_DEPTH}`,
      );
    }

    if (frontier.includes(rootRecommendationId)) {
      throw new BadRequestException(
        'Recommendation dependency graph cannot contain cycles',
      );
    }

    const nextIds = uniqueIds(
      frontier.filter((id) => !visited.has(id)),
    );

    if (nextIds.length === 0) {
      return;
    }

    nextIds.forEach((id) => visited.add(id));

    const nextDependencies = await recommendationRepository.find({
      where: { id: In(nextIds) },
      select: { id: true, userId: true, dependencyIds: true },
    });

    if (userId && nextDependencies.some((dependency) => dependency.userId !== userId)) {
      throw new BadRequestException('Dependencies must belong to the same user');
    }

    frontier = nextDependencies.flatMap(
      (dependency) => dependency.dependencyIds ?? [],
    );
  }
}

function uniqueIds(ids: string[]): string[] {
  return Array.from(new Set(ids));
}
