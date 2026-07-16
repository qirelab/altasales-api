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
>(items: readonly T[], options: CoverageSelectionOptions = {}): T[] {
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
    if (
      selected.some(
        (candidate) =>
          getCoverageRecommendationTargetId(candidate) === targetId,
      )
    ) {
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

    if (!item.packageId) {
      if (
        selected.some((candidate) =>
          hasCoverageIntersection(itemCoverage, getCoverageIds(candidate)),
        )
      ) {
        continue;
      }
      selected.push(item);
      continue;
    }

    const selectedItemsCoveredByPackage = selected.filter((candidate) => {
      const candidateCoverage = getCoverageIds(candidate);
      return candidate.packageId
        ? coversAllServices(itemCoverage, candidateCoverage)
        : hasCoverageIntersection(itemCoverage, candidateCoverage);
    });
    const selectedPackageCoveringItem = selected.some(
      (candidate) =>
        Boolean(candidate.packageId) &&
        coversAllServices(getCoverageIds(candidate), itemCoverage),
    );

    // A partially shared technical child service does not make two packages
    // mutually exclusive. Only a package that fully covers a selected target
    // can compact it.
    if (selectedPackageCoveringItem) continue;

    if (
      selectedItemsCoveredByPackage.some((candidate) =>
        idealTargetIds.has(getCoverageRecommendationTargetId(candidate) ?? ''),
      ) ||
      (selectedItemsCoveredByPackage.length > 0 &&
        Number(item.score ?? 0) <
          Math.max(
            ...selectedItemsCoveredByPackage.map((candidate) =>
              Number(candidate.score ?? 0),
            ),
          ) -
            tolerance)
    ) {
      continue;
    }

    selectedItemsCoveredByPackage.forEach((candidate) => {
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

export function getCoverageIds(item: CoverageRecommendationItem): Set<string> {
  const overlapIds = (item.coveredServiceIds ?? []).filter(isOverlapCoverageId);
  const ids = item.packageId
    ? canonicalizePackageCoverageIds(overlapIds)
    : overlapIds;
  if (ids.length === 0 && item.serviceId) ids.push(item.serviceId);
  return new Set(ids);
}

function canonicalizePackageCoverageIds(coverageIds: string[]): string[] {
  const canonicalIds: string[] = [];
  const pendingRawIds: string[] = [];

  coverageIds.forEach((coverageId) => {
    if (!coverageId.startsWith('catalog_name:')) {
      pendingRawIds.push(coverageId);
      return;
    }

    if (pendingRawIds.length === 0) {
      canonicalIds.push(coverageId);
      return;
    }

    // getPackageCoverageIds emits one raw service UUID followed by that
    // service's exact-name keys. Keep UUIDs for preceding short-named
    // services, while replacing only the UUID paired with this name key.
    canonicalIds.push(...pendingRawIds.slice(0, -1), coverageId);
    pendingRawIds.length = 0;
  });

  canonicalIds.push(...pendingRawIds);
  return canonicalIds;
}

function getBlockedCoverageExceptTarget(
  existingCoverage: readonly ExistingCoverageBlock[],
  targetId: string,
): Set<string> {
  const result = new Set<string>();
  existingCoverage.forEach((entry) => {
    if (!entry.blocksOverlaps || entry.targetId === targetId) return;
    entry.coveredServiceIds.forEach((serviceId) => {
      if (isOverlapCoverageId(serviceId)) result.add(serviceId);
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

function coversAllServices(
  coverage: Set<string>,
  targetCoverage: Set<string>,
): boolean {
  return (
    targetCoverage.size > 0 &&
    [...targetCoverage].every((serviceId) => coverage.has(serviceId))
  );
}

function isOverlapCoverageId(id: string): boolean {
  // Exact normalized names are safe internal identities for catalog rows that
  // were duplicated in the database under different UUIDs. Broad semantic
  // keys may describe related, but distinct, services and remain excluded.
  return !id.startsWith('catalog_semantic:');
}
