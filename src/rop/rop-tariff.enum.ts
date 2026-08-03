export enum RopTariff {
  Trainer = 'trainer',
  Hos = 'hos',
  Bitrix = 'bitrix',
  Full = 'full',
}

export const ROP_TARIFF_VALUES = Object.values(RopTariff);

export type RopTariffKey = `${RopTariff}`;
