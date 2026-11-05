import { UncategorizedTransactionsImportable } from './UncategorizedTransactionsImportable';
import { ImportModelShape } from '../../Import/models/Import';

const makeImportable = (existing: Record<string, any>[]) => {
  const query = {
    where: jest.fn().mockReturnThis(),
    whereBetween: jest.fn().mockReturnThis(),
    select: jest.fn().mockResolvedValue(existing),
  };
  const queryFactory = jest.fn(() => query);
  const uncategorizedModel = () => ({ query: queryFactory });
  const importable = new UncategorizedTransactionsImportable(
    {} as any,
    (() => ({})) as any,
    uncategorizedModel as any,
  );
  return { importable, query, queryFactory };
};

const importFile = {
  paramsParsed: { accountId: 1600 },
} as unknown as ImportModelShape;

describe('UncategorizedTransactionsImportable.getSkippedRows', () => {
  it('skips file rows already in the account', async () => {
    const { importable, query, queryFactory } = makeImportable([
      {
        date: new Date(2026, 0, 8),
        amount: '-5.00',
        payee: 'Tim Hortons',
        description: null,
        referenceNo: null,
      },
    ]);
    const parsed = [
      { date: '2026-01-07', amount: 20, payee: 'Shop' },
      { date: '2026-01-08', amount: -5, payee: 'tim hortons' },
    ];

    const skipped = await importable.getSkippedRows(parsed, importFile);

    expect(skipped).toEqual([
      {
        index: 1,
        errorCode: 'DuplicateBankTransaction',
        errorMessage:
          'Already in this bank account: 2026-01-08, tim hortons, -5.00',
      },
    ]);
    expect(queryFactory).toHaveBeenCalledTimes(1);
    expect(query.where).toHaveBeenCalledWith('accountId', 1600);
    expect(query.whereBetween).toHaveBeenCalledWith('date', [
      '2026-01-07',
      '2026-01-08',
    ]);
  });

  it('ignores rows with invalid dates and does not throw', async () => {
    const { importable, query } = makeImportable([]);
    const parsed = [
      { date: 'not a date', amount: -5 },
      { date: '2026-01-08', amount: -5, payee: 'x' },
    ];

    const skipped = await importable.getSkippedRows(parsed, importFile);

    expect(skipped).toEqual([]);
    expect(query.whereBetween).toHaveBeenCalledWith('date', [
      '2026-01-08',
      '2026-01-08',
    ]);
  });

  it('returns no rows without querying when no row has a valid date', async () => {
    const { importable, queryFactory } = makeImportable([]);

    const skipped = await importable.getSkippedRows(
      [{ date: '', amount: -5 }],
      importFile,
    );

    expect(skipped).toEqual([]);
    expect(queryFactory).not.toHaveBeenCalled();
  });
});

describe('UncategorizedTransactionsImportable.validateMapping', () => {
  const { importable } = makeImportable([]);

  it('refuses Amount mapped together with Deposit or Withdrawal', () => {
    expect(() =>
      importable.validateMapping([
        { from: 'A', to: 'amount' },
        { from: 'W', to: 'withdrawal' },
      ]),
    ).toThrow(
      expect.objectContaining({ errorType: 'IMPORT_AMOUNT_MAPPING_CONFLICT' }),
    );
  });

  it('accepts Amount alone, or Deposit and Withdrawal alone', () => {
    expect(() =>
      importable.validateMapping([{ from: 'A', to: 'amount' }]),
    ).not.toThrow();
    expect(() =>
      importable.validateMapping([
        { from: 'D', to: 'deposit' },
        { from: 'W', to: 'withdrawal' },
      ]),
    ).not.toThrow();
  });
});

describe('UncategorizedTransactionsImportable.prepareRows', () => {
  const { importable } = makeImportable([]);

  it('turns deposit/withdrawal columns into a signed amount', async () => {
    const { rows, rowErrors } = await importable.prepareRows(
      [{ date: '2026-02-02', withdrawal: 5 }],
      {
        mappingParsed: [{ from: 'W', to: 'withdrawal' }],
        paramsParsed: { accountId: 1 },
      } as unknown as ImportModelShape,
    );
    expect(rows).toEqual([{ date: '2026-02-02', amount: -5 }]);
    expect(rowErrors).toEqual([]);
  });

  it('reverses one-column amounts when reverseSigns is set', async () => {
    const { rows } = await importable.prepareRows(
      [{ amount: 5 }, { amount: -100 }],
      {
        mappingParsed: [{ from: 'A', to: 'amount' }],
        paramsParsed: { accountId: 1, reverseSigns: true },
      } as unknown as ImportModelShape,
    );
    expect(rows.map((row) => row.amount)).toEqual([-5, 100]);
  });
});

describe('UncategorizedTransactionsImportable.getPreviewSummary', () => {
  it('totals money in and out of the rows to be created', () => {
    const { importable } = makeImportable([]);

    expect(
      importable.getPreviewSummary([
        { index: 0, data: { amount: 100 } },
        { index: 1, data: { amount: -5 } },
      ]),
    ).toEqual({ moneyIn: 100, moneyOut: 5 });
  });
});

describe('UncategorizedTransactionsImportable.paramsValidationSchema', () => {
  const { importable } = makeImportable([]);

  it('accepts a boolean reverseSigns', async () => {
    await expect(
      importable
        .paramsValidationSchema()
        .validate({ accountId: 1, reverseSigns: true }, { strict: true }),
    ).resolves.toBeTruthy();
  });

  it('rejects a reverseSigns that is not a boolean', async () => {
    await expect(
      importable
        .paramsValidationSchema()
        .validate({ accountId: 1, reverseSigns: 'yes' }, { strict: true }),
    ).rejects.toBeTruthy();
  });
});
