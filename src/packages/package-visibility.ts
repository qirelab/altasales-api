import { IsNull, type FindOptionsWhere, type SelectQueryBuilder } from 'typeorm';
import { ServicePackage } from './entities/package.entity';

export const activePackageWhere = (): FindOptionsWhere<ServicePackage> => ({
  deletedAt: IsNull(),
});

export function applyActivePackageFilter(
  qb: SelectQueryBuilder<ServicePackage>,
  alias = 'sp',
): SelectQueryBuilder<ServicePackage> {
  return qb.andWhere(`${alias}."deletedAt" IS NULL`);
}

export function isPackageActive(pkg: ServicePackage | null | undefined): boolean {
  return Boolean(pkg && pkg.deletedAt == null);
}
