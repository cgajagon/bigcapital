/**
 * The percentage a document stored for each tax it uses, keyed by tax rate id.
 */
export type DocumentTaxRates = Record<number, number>;

interface TaxedEntry {
  taxRateId?: number | null;
  taxRate?: number | string | null;
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

  (entries || []).forEach((entry) => {
    if (
      entry.taxRateId &&
      entry.taxRate !== null &&
      entry.taxRate !== undefined &&
      !(entry.taxRateId in documentTaxRates)
    ) {
      documentTaxRates[entry.taxRateId] = Number(entry.taxRate);
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
  return entries.map((entry) =>
    entry.taxRateId && entry.taxRateId in documentTaxRates
      ? { ...entry, taxRate: documentTaxRates[entry.taxRateId] }
      : entry,
  );
};
