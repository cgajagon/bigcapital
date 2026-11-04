import type { TaxRate } from '@bigcapital/sdk-ts';

type TaxRateId = number | string | null | undefined;

const isSameTaxRateId = (taxRate: TaxRate, id: TaxRateId) =>
  id !== null &&
  id !== undefined &&
  id !== '' &&
  String(taxRate.id) === String(id);

/**
 * Retrieves the tax rates that can be picked: the active ones, plus the
 * already selected ones even if they're inactive now.
 * @param {TaxRate[]} taxRates - All the tax rates.
 * @param {TaxRateId[]} keepIds - The selected tax rate ids to keep.
 * @returns {TaxRate[]}
 */
export const getSelectableTaxRates = (
  taxRates: TaxRate[] | undefined,
  keepIds: TaxRateId[],
): TaxRate[] =>
  (taxRates || []).filter(
    (taxRate) =>
      taxRate.active || keepIds.some((id) => isSameTaxRateId(taxRate, id)),
  );

/**
 * Determines whether the given tax rate id belongs to an active tax rate.
 * @param {TaxRate[]} taxRates - All the tax rates.
 * @param {TaxRateId} id - The tax rate id.
 * @returns {boolean}
 */
export const isActiveTaxRate = (
  taxRates: TaxRate[] | undefined,
  id: TaxRateId,
): boolean =>
  !!(taxRates || []).find((taxRate) => isSameTaxRateId(taxRate, id))?.active;
