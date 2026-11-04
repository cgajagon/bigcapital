import {
  aggregateComponentTaxes,
  roundHalfAwayFromZero,
  TaxComponentAmount,
} from '@bigcapital/utils';
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
 * Gets the tax of each line of a document split per tax rate: one item per
 * group component, one for a plain rate, none for an untaxed line. Each line's
 * components add up to its allocated line tax (`getDocumentLineTaxes`); the
 * difference goes to its largest component.
 * A taxed line without a tax rate id (stale data) keeps its line tax as one
 * item, so it is still posted.
 * @param document
 * @returns {TaxComponentAmount[][]} One array per line, in entry order.
 */
export const getDocumentLineComponentTaxes = (document: {
  entries?: ItemEntry[];
  taxAmountWithheld?: number | null;
}): TaxComponentAmount[][] => {
  const lineTaxes = getDocumentLineTaxes(document);

  return (document.entries ?? []).map((entry, index) => {
    const lineTax = lineTaxes[index];
    // A plain object entry has no getter: it posts its line tax, as before.
    const components = entry.componentTaxes ?? [];

    if (components.length === 0) {
      return lineTax !== 0
        ? [{ taxRateId: entry.taxRateId, rate: entry.taxRate, amount: lineTax }]
        : [];
    }
    const amounts = allocateDocumentLineTaxes(
      components.map((component) => component.amount),
      lineTax,
    );
    return components.map((component, i) => ({
      ...component,
      amount: amounts[i],
    }));
  });
};

/**
 * Sums the allocated line taxes of a document per component tax rate (a group
 * line counts for its components, never for the group), rounded to cents.
 * @param document
 * @returns {Record<number, number>}
 */
export const getLineTaxesByTaxRateId = (document: {
  entries?: ItemEntry[];
  taxAmountWithheld?: number | null;
}): Record<number, number> => {
  const totals: Record<number, number> = {};

  aggregateComponentTaxes(getDocumentLineComponentTaxes(document)).forEach(
    (component) => {
      if (!component.taxRateId) return;
      totals[component.taxRateId] = component.amount;
    },
  );
  return totals;
};
