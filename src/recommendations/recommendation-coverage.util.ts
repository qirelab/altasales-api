export type CoverageRecommendationItem = {
  serviceId: string | null;
  packageId?: string | null;
  coveredServiceIds?: string[];
  coverageKeys?: string[];
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

export type DominatedPackageResidual<T extends CoverageRecommendationItem> = {
  packageItem: T;
  dominantPackageItem: T;
  uncoveredCoverageIds: ReadonlySet<string>;
};

const DEFAULT_PACKAGE_REPLACEMENT_SCORE_TOLERANCE = 15;
const DOMINANT_PACKAGE_COVERAGE_RATIO = 0.8;
const MIN_DOMINANT_PACKAGE_SHARED_SERVICES = 2;

/**
 * Selects a relevance-ranked set without recommending a covered child next to
 * its package. Package composition is supplied by the catalog and is never
 * inferred from a package name.
 */
export function selectNonOverlappingRecommendations<
  T extends CoverageRecommendationItem,
>(items: readonly T[], options: CoverageSelectionOptions = {}): T[] {
  // Remove a package that is almost entirely included in a larger package
  // before processing child services. The usual coverage pass can then keep
  // only relevant services from the smaller package's uncovered remainder.
  const candidates = excludeNearlyCoveredPackages(items, options);

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

  for (const item of candidates) {
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

function excludeNearlyCoveredPackages<T extends CoverageRecommendationItem>(
  items: readonly T[],
  options: CoverageSelectionOptions,
): T[] {
  const excludedTargetIds = new Set(
    findDominatedPackageResiduals(items, options)
      .map(({ packageItem }) => getCoverageRecommendationTargetId(packageItem))
      .filter((targetId): targetId is string => Boolean(targetId)),
  );

  return items.filter((item) => {
    if (!item.packageId) return true;

    const targetId = getCoverageRecommendationTargetId(item);
    return !targetId || !excludedTargetIds.has(targetId);
  });
}

export function findDominatedPackageResiduals<
  T extends CoverageRecommendationItem,
>(
  items: readonly T[],
  options: CoverageSelectionOptions = {},
): DominatedPackageResidual<T>[] {
  const idealTargetIds = options.idealTargetIds ?? new Set<string>();
  const tolerance =
    options.packageReplacementScoreTolerance ??
    DEFAULT_PACKAGE_REPLACEMENT_SCORE_TOLERANCE;

  return items.flatMap((packageItem) => {
    if (!packageItem.packageId) return [];
    const targetId = getCoverageRecommendationTargetId(packageItem);
    if (!targetId || idealTargetIds.has(targetId)) return [];

    const packageCoverage = getCoverageIds(packageItem);
    const dominantPackageItem = items
      .filter(
        (candidate) =>
          Boolean(candidate.packageId) &&
          candidate !== packageItem &&
          isDominantPackage(candidate, packageItem, packageCoverage, tolerance),
      )
      .sort(
        (left, right) =>
          countSharedCoverage(right, packageCoverage) -
          countSharedCoverage(left, packageCoverage),
      )[0];
    if (!dominantPackageItem) return [];

    const dominantCoverage = getCoverageIds(dominantPackageItem);
    const uncoveredCoverageIds = new Set(
      [...packageCoverage].filter(
        (coverageId) => !dominantCoverage.has(coverageId),
      ),
    );

    return [
      {
        packageItem,
        dominantPackageItem,
        uncoveredCoverageIds,
      },
    ];
  });
}

function countSharedCoverage(
  item: CoverageRecommendationItem,
  coverage: ReadonlySet<string>,
): number {
  return [...getCoverageIds(item)].filter((coverageId) =>
    coverage.has(coverageId),
  ).length;
}

function isDominantPackage<T extends CoverageRecommendationItem>(
  candidate: T,
  coveredPackage: T,
  coveredPackageCoverage: Set<string>,
  tolerance: number,
): boolean {
  const candidateCoverage = getCoverageIds(candidate);
  if (candidateCoverage.size <= coveredPackageCoverage.size) return false;

  const sharedServices = [...coveredPackageCoverage].filter((serviceId) =>
    candidateCoverage.has(serviceId),
  ).length;
  if (sharedServices < MIN_DOMINANT_PACKAGE_SHARED_SERVICES) return false;
  if (
    sharedServices / coveredPackageCoverage.size <
    DOMINANT_PACKAGE_COVERAGE_RATIO
  ) {
    return false;
  }

  return (
    Number(candidate.score ?? 0) >=
    Number(coveredPackage.score ?? 0) - tolerance
  );
}
export function getCoverageRecommendationTargetId(
  item: CoverageRecommendationItem,
): string | null {
  return item.packageId ?? item.serviceId ?? null;
}

export function getCoverageIds(item: CoverageRecommendationItem): Set<string> {
  const overlapIds = (
    item.coverageKeys?.length
      ? item.coverageKeys
      : (item.coveredServiceIds ?? [])
  ).filter(isOverlapCoverageId);
  const ids = overlapIds;
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
