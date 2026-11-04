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
 * Determines whether the given tax rate id belongs to a tax rate known to be
 * inactive. A rate missing from the list (e.g. not loaded yet) isn't.
 * @param {TaxRate[]} taxRates - All the tax rates.
 * @param {TaxRateId} id - The tax rate id.
 * @returns {boolean}
 */
export const isInactiveTaxRate = (
  taxRates: TaxRate[] | undefined,
  id: TaxRateId,
): boolean => {
  const taxRate = (taxRates || []).find((rate) => isSameTaxRateId(rate, id));

  return !!taxRate && !taxRate.active;
};

/**
 * Labels the taxes a saved document already uses with the document's own
 * percentage, which its lines keep, instead of the rate's current one.
 * @param {TaxRate[]} taxRates - The tax rates to label.
 * @param {Record<string, number>} documentTaxRates - The document's percentages.
 * @returns {TaxRate[]}
 */
export const withDocumentTaxRateLabels = (
  taxRates: TaxRate[],
  documentTaxRates?: Record<string, number>,
): TaxRate[] =>
  taxRates.map((taxRate) => {
    const documentTaxRate = documentTaxRates?.[String(taxRate.id)];

    return documentTaxRate === undefined
      ? taxRate
      : { ...taxRate, nameFormatted: `${taxRate.name} [${documentTaxRate}%]` };
  });
