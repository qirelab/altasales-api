import { IsNull, type FindOptionsWhere, type SelectQueryBuilder } from 'typeorm';
import { Service } from './entities/service.entity';

export const activeServiceWhere = (): FindOptionsWhere<Service> => ({
  deletedAt: IsNull(),
});

export function applyActiveServiceFilter(
  qb: SelectQueryBuilder<Service>,
  alias = 'service',
): SelectQueryBuilder<Service> {
  return qb.andWhere(`${alias}."deletedAt" IS NULL`);
}

export function isServiceActive(service: Service | null | undefined): boolean {
  return Boolean(service && service.deletedAt == null);
}

export function filterActiveServices(services: Service[] | undefined): Service[] {
  return (services ?? []).filter(isServiceActive);
}
