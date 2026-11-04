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

  it('reads percentages given as decimal strings', () => {
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

describe('group lines', () => {
  const oldEntries: any[] = [
    {
      taxRateId: 9,
      taxRate: 14.975,
      taxComponents: [
        { taxRateId: 1, rate: 5 },
        { taxRateId: 2, rate: 9.975 },
      ],
    },
    { taxRateId: 1, taxRate: 5, taxComponents: null },
  ];

  it('maps component ids to their stored percentages too, first one wins', () => {
    expect(getDocumentTaxRates(oldEntries)).toEqual({
      9: 14.975,
      1: 5,
      2: 9.975,
    });
    expect(
      getDocumentTaxRates([
        { taxRateId: 1, taxRate: 4 },
        {
          taxRateId: 9,
          taxRate: 15,
          taxComponents: [{ taxRateId: 1, rate: 5 }],
        },
      ] as any),
    ).toEqual({ 1: 4, 9: 15 });
  });

  it('keeps the old components on every group line, without sharing arrays', () => {
    const fresh = () => ({
      taxRateId: 9,
      taxRate: 15,
      taxComponents: [
        { taxRateId: 1, rate: 5 },
        { taxRateId: 2, rate: 10 },
      ],
    });
    const input = [fresh(), fresh()];
    const out = applyDocumentTaxRates(input, getDocumentTaxRates(oldEntries));

    out.forEach((line) => {
      expect(line.taxRate).toBe(14.975);
      expect(line.taxComponents).toEqual([
        { taxRateId: 1, rate: 5 },
        { taxRateId: 2, rate: 9.975 },
      ]);
    });
    expect(out[0].taxComponents).not.toBe(out[1].taxComponents);
    expect(input[0].taxComponents[1].rate).toBe(10);
    expect(input[0].taxRate).toBe(15);
  });

  it('keeps the current components of a group the old document lacked', () => {
    const out = applyDocumentTaxRates(
      [
        {
          taxRateId: 10,
          taxRate: 12,
          taxComponents: [
            { taxRateId: 3, rate: 7 },
            { taxRateId: 4, rate: 5 },
          ],
        },
      ],
      getDocumentTaxRates(oldEntries),
    );
    expect(out[0].taxRate).toBe(12);
    expect(out[0].taxComponents).toEqual([
      { taxRateId: 3, rate: 7 },
      { taxRateId: 4, rate: 5 },
    ]);
  });

  it('keeps a plain line on its stored percentage', () => {
    expect(
      applyDocumentTaxRates(
        [{ taxRateId: 1, taxRate: 5.5, taxComponents: null }],
        getDocumentTaxRates(oldEntries),
      ),
    ).toEqual([{ taxRateId: 1, taxRate: 5, taxComponents: null }]);
  });
});

describe('ItemEntriesTaxTransactions.assocTaxRateFromTaxIdToEntries', () => {
  const rates = [
    {
      id: 9,
      rate: '14.9750',
      isGroup: true,
      components: [
        { id: 1, rate: '5.0000' },
        { id: 2, rate: '9.9750' },
      ],
    },
    { id: 1, rate: '5.0000', isGroup: false, components: [] },
  ];
  const buildService = () => {
    const query: any = {
      withGraphFetched: jest.fn(() => query),
      whereIn: jest.fn(async (_c: string, ids: number[]) =>
        rates.filter((r) => ids.includes(r.id)),
      ),
    };
    return {
      query,
      service: new ItemEntriesTaxTransactions(
        {} as any,
        (() => ({ query: () => query })) as any,
        { accessible: async () => true } as any,
      ),
    };
  };

  it('stamps a group line with its components and their sum', async () => {
    const { service, query } = buildService();
    const out: any[] = await service.assocTaxRateFromTaxIdToEntries([
      { taxRateId: 9 },
      { taxRateId: 1, taxComponents: [{ taxRateId: 5, rate: 1 }] },
      {},
    ] as any);

    expect(query.withGraphFetched).toHaveBeenCalledWith('components');
    expect(out[0].taxRate).toBe(14.975);
    expect(out[0].taxComponents).toEqual([
      { taxRateId: 1, rate: 5 },
      { taxRateId: 2, rate: 9.975 },
    ]);
    expect(out[1].taxRate).toBe('5.0000');
    expect(out[1].taxComponents).toBeNull();
  });
});
