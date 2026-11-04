import { applyDocumentTaxRates, getDocumentTaxRates } from './DocumentTaxRates';
import { ItemEntriesTaxTransactions } from './ItemEntriesTaxTransactions.service';

describe('getDocumentTaxRates', () => {
  it('maps each tax rate id to the percentage the document stored', () => {
    expect(
      getDocumentTaxRates([
        { taxRateId: 1, taxRate: 10 },
        { taxRateId: 1, taxRate: 10 },
        { taxRateId: 2, taxRate: 0 },
        { taxRateId: 3, taxRate: null },
        { taxRateId: null, taxRate: 0 },
      ]),
    ).toEqual({ 1: 10, 2: 0 });
  });

  it('reads percentages stored as decimal strings', () => {
    expect(
      getDocumentTaxRates([
        { taxRateId: 5, taxRate: '9.9750' },
        { taxRateId: 6, taxRate: '0.0000' },
      ]),
    ).toEqual({ 5: 9.975, 6: 0 });
  });

  it('keeps the first percentage when a tax appears twice', () => {
    expect(
      getDocumentTaxRates([
        { taxRateId: 1, taxRate: 10 },
        { taxRateId: 1, taxRate: 12 },
      ]),
    ).toEqual({ 1: 10 });
  });

  it('returns an empty map without entries', () => {
    expect(getDocumentTaxRates(undefined)).toEqual({});
  });
});

describe('applyDocumentTaxRates', () => {
  it("gives lines the document's percentage for the taxes it already used", () => {
    const input = [
      { taxRateId: 1, taxRate: 20 },
      { taxRateId: 4, taxRate: 5 },
      { taxRateId: null },
    ];

    expect(applyDocumentTaxRates(input, { 1: 10 })).toEqual([
      { taxRateId: 1, taxRate: 10 },
      { taxRateId: 4, taxRate: 5 },
      { taxRateId: null },
    ]);
    expect(input[0].taxRate).toBe(20);
  });

  it('keeps a stored 0 % instead of the current percentage', () => {
    expect(
      applyDocumentTaxRates([{ taxRateId: 2, taxRate: 5 }], { 2: 0 }),
    ).toEqual([{ taxRateId: 2, taxRate: 0 }]);
  });
});

describe('ItemEntriesTaxTransactions.assocDocumentTaxRatesToEntries', () => {
  const buildService = (salesTaxEnabled: boolean) =>
    new ItemEntriesTaxTransactions(
      {} as any,
      {} as any,
      { accessible: async () => salesTaxEnabled } as any,
    );

  it("applies the old document's percentages", async () => {
    const assoc = buildService(true).assocDocumentTaxRatesToEntries([
      { taxRateId: 1, taxRate: 10 },
    ] as any);

    await expect(
      assoc([{ taxRateId: 1, taxRate: 20 }] as any),
    ).resolves.toEqual([{ taxRateId: 1, taxRate: 10 }]);
  });

  it('leaves the entries alone when sales tax is disabled', async () => {
    const assoc = buildService(false).assocDocumentTaxRatesToEntries([
      { taxRateId: 1, taxRate: 10 },
    ] as any);

    await expect(
      assoc([{ taxRateId: 1, taxRate: 20 }] as any),
    ).resolves.toEqual([{ taxRateId: 1, taxRate: 20 }]);
  });
});
