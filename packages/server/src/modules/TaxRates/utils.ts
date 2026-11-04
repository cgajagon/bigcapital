import { roundHalfAwayFromZero } from '@bigcapital/utils';
import type { ItemEntry } from '@/modules/TransactionItemEntry/models/ItemEntry';

/**
 * Adds the difference between the document's stored tax and the sum of the
 * line taxes to the line with the largest absolute non-zero tax (the first
 * one on a tie), so the line taxes add up to the stored document tax exactly.
 * @param {number[]} lineTaxes - Cent-rounded tax of each line.
 * @param {number | null | undefined} documentTax - The stored document tax.
 * @returns {number[]}
 */
export const allocateDocumentLineTaxes = (
  lineTaxes: number[],
  documentTax: number | null | undefined,
): number[] => {
  if (documentTax === null || documentTax === undefined) return [...lineTaxes];

  const diff = roundHalfAwayFromZero(
    documentTax - lineTaxes.reduce((sum, tax) => sum + tax, 0),
  );
  if (diff === 0) return [...lineTaxes];

  let target = -1;
  lineTaxes.forEach((tax, index) => {
    if (
      tax !== 0 &&
      (target < 0 || Math.abs(tax) > Math.abs(lineTaxes[target]))
    ) {
      target = index;
    }
  });
  if (target < 0) return [...lineTaxes];

  return lineTaxes.map((tax, index) =>
    index === target ? roundHalfAwayFromZero(tax + diff) : tax,
  );
};

/**
 * Gets the line taxes of a document, reconciled with its stored tax.
 * @param document
 * @returns {number[]}
 */
export const getDocumentLineTaxes = (document: {
  entries?: ItemEntry[];
  taxAmountWithheld?: number | null;
}): number[] =>
  allocateDocumentLineTaxes(
    (document.entries ?? []).map((entry) => entry.taxAmount),
    document.taxAmountWithheld,
  );

/**
 * Sums the allocated line taxes of a document per tax rate, rounded to cents.
 * @param document
 * @returns {Record<number, number>}
 */
export const getLineTaxesByTaxRateId = (document: {
  entries?: ItemEntry[];
  taxAmountWithheld?: number | null;
}): Record<number, number> => {
  const lineTaxes = getDocumentLineTaxes(document);
  const totals: Record<number, number> = {};

  (document.entries ?? []).forEach((entry, index) => {
    if (!entry.taxRateId) return;
    totals[entry.taxRateId] = (totals[entry.taxRateId] ?? 0) + lineTaxes[index];
  });
  Object.keys(totals).forEach((id) => {
    totals[id] = roundHalfAwayFromZero(totals[id]);
  });
  return totals;
};
