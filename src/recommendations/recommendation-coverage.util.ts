export type CoverageRecommendationItem = {
  serviceId: string | null;
  packageId?: string | null;
  coveredServiceIds?: string[];
  score?: number;
};

export type ExistingCoverageBlock = {
  targetId: string;
  coveredServiceIds: ReadonlySet<string>;
  blocksOverlaps: boolean;
};

export type CoverageSelectionOptions = {
  existingCoverage?: readonly ExistingCoverageBlock[];
  idealTargetIds?: ReadonlySet<string>;
  packageReplacementScoreTolerance?: number;
};

const DEFAULT_PACKAGE_REPLACEMENT_SCORE_TOLERANCE = 15;

/**
 * Selects a relevance-ranked set without recommending a covered child next to
 * its package. Package composition is supplied by the catalog and is never
 * inferred from a package name.
 */
export function selectNonOverlappingRecommendations<
  T extends CoverageRecommendationItem,
>(
  items: readonly T[],
  options: CoverageSelectionOptions = {},
): T[] {
  const selected: T[] = [];
  const blockedTargets = new Set(
    (options.existingCoverage ?? [])
      .filter((entry) => entry.blocksOverlaps)
      .map((entry) => entry.targetId),
  );
  const idealTargetIds = options.idealTargetIds ?? new Set<string>();
  const tolerance =
    options.packageReplacementScoreTolerance ??
    DEFAULT_PACKAGE_REPLACEMENT_SCORE_TOLERANCE;

  for (const item of items) {
    const targetId = getCoverageRecommendationTargetId(item);
    if (!targetId || blockedTargets.has(targetId)) continue;
    if (selected.some((candidate) => getCoverageRecommendationTargetId(candidate) === targetId)) {
      continue;
    }

    const itemCoverage = getCoverageIds(item);
    const blockedCoverage = getBlockedCoverageExceptTarget(
      options.existingCoverage ?? [],
      targetId,
    );
    if ([...itemCoverage].some((serviceId) => blockedCoverage.has(serviceId))) {
      continue;
    }

    const overlappingSelected = selected.filter((candidate) =>
      hasCoverageIntersection(itemCoverage, getCoverageIds(candidate)),
    );

    if (overlappingSelected.length === 0) {
      selected.push(item);
      continue;
    }

    if (
      !item.packageId ||
      overlappingSelected.some((candidate) =>
        idealTargetIds.has(getCoverageRecommendationTargetId(candidate) ?? ''),
      ) ||
      !coversAllSelectedItems(itemCoverage, overlappingSelected) ||
      Number(item.score ?? 0) <
        Math.max(...overlappingSelected.map((candidate) => Number(candidate.score ?? 0))) -
          tolerance
    ) {
      continue;
    }

    overlappingSelected.forEach((candidate) => {
      const index = selected.indexOf(candidate);
      if (index !== -1) selected.splice(index, 1);
    });
    selected.push(item);
  }

  return selected;
}

export function getCoverageRecommendationTargetId(
  item: CoverageRecommendationItem,
): string | null {
  return item.packageId ?? item.serviceId ?? null;
}

export function getCoverageIds(
  item: CoverageRecommendationItem,
): Set<string> {
  const ids = (item.coveredServiceIds ?? []).filter(isPublicCoverageId);
  if (ids.length === 0 && item.serviceId) ids.push(item.serviceId);
  return new Set(ids);
}

function getBlockedCoverageExceptTarget(
  existingCoverage: readonly ExistingCoverageBlock[],
  targetId: string,
): Set<string> {
  const result = new Set<string>();
  existingCoverage.forEach((entry) => {
    if (!entry.blocksOverlaps || entry.targetId === targetId) return;
    entry.coveredServiceIds.forEach((serviceId) => {
      if (isPublicCoverageId(serviceId)) result.add(serviceId);
    });
  });
  return result;
}

function hasCoverageIntersection(
  left: Set<string>,
  right: Set<string>,
): boolean {
  return [...left].some((serviceId) => right.has(serviceId));
}

function coversAllSelectedItems(
  packageCoverage: Set<string>,
  selectedItems: readonly CoverageRecommendationItem[],
): boolean {
  return selectedItems.every((item) =>
    [...getCoverageIds(item)].every((serviceId) =>
      packageCoverage.has(serviceId),
    ),
  );
}

function isPublicCoverageId(id: string): boolean {
  return !id.startsWith('catalog_name:') && !id.startsWith('catalog_semantic:');
}
