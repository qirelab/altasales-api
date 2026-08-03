import { RopTariff, type RopTariffKey } from './rop-tariff.enum';

export type { RopTariffKey };

const TARIFF_PRIORITY: Record<RopTariffKey, number> = {
  [RopTariff.Trainer]: 1,
  [RopTariff.Bitrix]: 2,
  [RopTariff.Hos]: 3,
  [RopTariff.Full]: 4,
};

export function isRopTariff(value: unknown): value is RopTariffKey {
  return (
    typeof value === 'string' &&
    Object.prototype.hasOwnProperty.call(TARIFF_PRIORITY, value)
  );
}

export function pickHighestTariff(
  tariffs: Iterable<RopTariffKey | null | undefined>,
): RopTariffKey | null {
  let best: RopTariffKey | null = null;
  let bestPriority = 0;

  for (const tariff of tariffs) {
    if (!tariff || !isRopTariff(tariff)) {
      continue;
    }

    const priority = TARIFF_PRIORITY[tariff];
    if (priority > bestPriority) {
      best = tariff;
      bestPriority = priority;
    }
  }

  return best;
}
