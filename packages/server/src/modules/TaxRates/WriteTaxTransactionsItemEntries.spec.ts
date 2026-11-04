import { WriteTaxTransactionsItemEntries } from './WriteTaxTransactionsItemEntries';

describe('WriteTaxTransactionsItemEntries', () => {
  const buildWriter = (currentRate: number) => {
    const upsertGraph = jest.fn().mockResolvedValue([]);
    const writer = new WriteTaxTransactionsItemEntries(
      (() => ({ query: () => ({ upsertGraph }) })) as any,
      (() => ({
        query: () => ({
          whereIn: async () => [{ id: 1, rate: currentRate }],
        }),
      })) as any,
      { accessible: async () => true } as any,
    );
    return { writer, upsertGraph };
  };

  it("stores a document's 0 % even when the rate is now higher", async () => {
    const { writer, upsertGraph } = buildWriter(5);

    await writer.writeTaxTransactionsFromItemEntries([
      {
        taxRateId: 1,
        taxRate: 0,
        amount: 100,
        referenceType: 'SaleInvoice',
        referenceId: 7,
      },
    ] as any);

    expect(upsertGraph).toHaveBeenCalledWith([
      expect.objectContaining({ taxRateId: 1, rate: 0 }),
    ]);
  });

  it("falls back to the rate's percentage when the line has none", async () => {
    const { writer, upsertGraph } = buildWriter(5);

    await writer.writeTaxTransactionsFromItemEntries([
      {
        taxRateId: 1,
        taxRate: null,
        amount: 100,
        referenceType: 'SaleInvoice',
        referenceId: 7,
      },
    ] as any);

    expect(upsertGraph).toHaveBeenCalledWith([
      expect.objectContaining({ taxRateId: 1, rate: 5 }),
    ]);
  });

  it('writes one row per distinct component, in line-then-component order', async () => {
    const upsertGraph = jest.fn().mockResolvedValue([]);
    const writer = new WriteTaxTransactionsItemEntries(
      (() => ({ query: () => ({ upsertGraph }) })) as any,
      (() => ({
        query: () => ({
          whereIn: async () => [
            { id: 1, rate: 5 },
            { id: 2, rate: 9.975 },
          ],
        }),
      })) as any,
      { accessible: async () => true } as any,
    );
    const ref = { referenceType: 'SaleInvoice', referenceId: 7 };
    const components = [
      { taxRateId: 1, rate: 5 },
      { taxRateId: 2, rate: 9.975 },
    ];

    await writer.writeTaxTransactionsFromItemEntries([
      { taxRateId: 1, taxRate: 5, amount: 10, ...ref },
      {
        taxRateId: 9,
        taxRate: 14.975,
        taxComponents: components,
        amount: 37.5,
        ...ref,
      },
      {
        taxRateId: 9,
        taxRate: 14.975,
        taxComponents: components,
        amount: -4.5,
        ...ref,
      },
    ] as any);

    expect(upsertGraph).toHaveBeenCalledWith([
      { taxRateId: 1, rate: 5, ...ref },
      { taxRateId: 2, rate: 9.975, ...ref },
    ]);
  });
});
