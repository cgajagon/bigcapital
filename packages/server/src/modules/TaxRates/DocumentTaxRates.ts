/**
 * The percentage a document stored for each tax it uses, keyed by tax rate id.
 */
import { sumComponentRates } from './TaxRateGroups';

export type DocumentTaxRates = Record<number, number>;

interface TaxedEntry {
  taxRateId?: number | null;
  taxRate?: number | string | null;
  taxComponents?: { taxRateId: number; rate: number | string }[] | null;
}

/**
 * Reads the percentage a saved document stored for each tax it uses.
 * Lines with no stored percentage are skipped, so their tax falls back to the
 * rate's current percentage; a stored 0 is kept. Percentages given as decimal
 * strings are read as numbers.
 * @param {TaxedEntry[]} entries - The saved document's entries.
 * @returns {DocumentTaxRates}
 */
export const getDocumentTaxRates = (
  entries?: TaxedEntry[],
): DocumentTaxRates => {
  const documentTaxRates: DocumentTaxRates = {};

  const remember = (id: number, rate: number | string) => {
    if (!(id in documentTaxRates)) documentTaxRates[id] = Number(rate);
  };

  (entries || []).forEach((entry) => {
    (entry.taxComponents || []).forEach((c) => {
      if (c.rate !== null && c.rate !== undefined)
        remember(c.taxRateId, c.rate);
    });
    if (
      entry.taxRateId &&
      entry.taxRate !== null &&
      entry.taxRate !== undefined &&
      !(entry.taxRateId in documentTaxRates)
    ) {
      remember(entry.taxRateId, entry.taxRate);
    }
  });
  return documentTaxRates;
};

/**
 * Gives every line whose tax the document already used the document's stored
 * percentage for that tax, so re-saving a document never changes its rates.
 * @param {T[]} entries - The entries being saved.
 * @param {DocumentTaxRates} documentTaxRates - The saved document's percentages.
 * @returns {T[]}
 */
export const applyDocumentTaxRates = <T extends TaxedEntry>(
  entries: T[],
  documentTaxRates: DocumentTaxRates,
): T[] => {
  return entries.map((entry) => {
    if (entry.taxComponents?.length) {
      // A group line keeps each component's stored percentage; the group's own
      // id never decides it.
      const taxComponents = entry.taxComponents.map((c) => ({
        ...c,
        rate:
          c.taxRateId in documentTaxRates
            ? documentTaxRates[c.taxRateId]
            : c.rate,
      }));
      return {
        ...entry,
        taxComponents,
        taxRate: sumComponentRates(taxComponents.map((c) => Number(c.rate))),
      };
    }
    return entry.taxRateId && entry.taxRateId in documentTaxRates
      ? { ...entry, taxRate: documentTaxRates[entry.taxRateId] }
      : entry;
  });
};
