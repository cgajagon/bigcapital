import { TakeOverReconciledTransaction } from './TakeOverReconciledTransaction.subscriber';

describe('TakeOverReconciledTransaction', () => {
  const trx = { id: 'trx' } as any;
  const OLD = { referenceType: 'CashflowTransaction', referenceId: 10 };

  let bankRows: Array<{
    reconciliationTransactionId: number;
    uncategorizedTransactionId: number;
  }>;
  let reconciledRows: any[];
  let ledger: Array<{ type: string; id: number }>;
  let matchedRows: any[];
  let patch: jest.Mock;
  let queriedWith: any[];
  let subscriber: TakeOverReconciledTransaction;

  /**
   * Chainable query double: records the where conditions and resolves the
   * rows through `resolve`.
   */
  const model = (
    resolve: (conditions: Record<string, any>, first: boolean) => any,
  ) =>
    jest.fn(() => ({
      query: jest.fn((passedTrx: any) => {
        queriedWith.push(passedTrx);
        const conditions: Record<string, any> = {};
        let first = false;
        const chain: any = {
          where: jest.fn((column: any, value?: any) => {
            if (typeof column === 'string') conditions[column] = value;
            return chain;
          }),
          whereIn: jest.fn((column: string, values: any[]) => {
            conditions[column] = values;
            return chain;
          }),
          first: jest.fn(() => {
            first = true;
            return chain;
          }),
          findById: jest.fn(() => chain),
          patch: jest.fn((values: any) => {
            patch(values);
            return Promise.resolve(1);
          }),
          then: (onFulfilled: any, onRejected: any) =>
            Promise.resolve(resolve(conditions, first)).then(
              onFulfilled,
              onRejected,
            ),
        };
        return chain;
      }),
    }));

  beforeEach(() => {
    queriedWith = [];
    patch = jest.fn();
    bankRows = [
      { reconciliationTransactionId: 1, uncategorizedTransactionId: 7 },
    ];
    reconciledRows = [{ id: 1, accountId: 5, ...OLD }];
    // Only the new transaction is on the account: the old one was deleted.
    ledger = [{ type: 'CashflowTransaction', id: 11 }];
    matchedRows = [];

    const bankRowModel = model((conditions) =>
      conditions.uncategorized_transaction_id
        ? bankRows.filter((r) =>
            conditions.uncategorized_transaction_id.includes(
              r.uncategorizedTransactionId,
            ),
          )
        : bankRows.filter((r) =>
            conditions.reconciliation_transaction_id.includes(
              r.reconciliationTransactionId,
            ),
          ),
    );
    const reconciliationModel = model((conditions, first) => {
      if (first) {
        return reconciledRows.find(
          (r) =>
            r.referenceType === conditions.reference_type &&
            r.referenceId === conditions.reference_id,
        );
      }
      return reconciledRows.filter((r) => conditions.id.includes(r.id));
    });
    const ledgerModel = model((conditions) =>
      ledger.find(
        (l) =>
          l.type === conditions.reference_type &&
          l.id === conditions.reference_id,
      ),
    );
    const matchedModel = model(() => matchedRows);

    subscriber = new TakeOverReconciledTransaction(
      reconciliationModel as any,
      bankRowModel as any,
      ledgerModel as any,
      matchedModel as any,
    );
  });

  const categorized = (ids: number[], cashflowId = 11) =>
    subscriber.handleCategorized({
      cashflowTransaction: { id: cashflowId },
      uncategorizedTransactions: ids.map((id) => ({ id })),
      trx,
    } as any);

  it('updates the reference when all stored rows are relinked and the old ref is gone', async () => {
    await categorized([7]);

    expect(patch).toHaveBeenCalledWith({
      referenceType: 'CashflowTransaction',
      referenceId: 11,
    });
    expect(queriedWith.every((passed) => passed === trx)).toBe(true);
  });

  it('leaves the reconciled row on a partial relink', async () => {
    bankRows.push({
      reconciliationTransactionId: 1,
      uncategorizedTransactionId: 8,
    });

    await categorized([7]);

    expect(patch).not.toHaveBeenCalled();
  });

  it('leaves the reconciled row when the old transaction is still on the account', async () => {
    ledger.push({ type: 'CashflowTransaction', id: 10 });

    await categorized([7]);

    expect(patch).not.toHaveBeenCalled();
  });

  it('leaves the reconciled row when the new transaction is already reconciled', async () => {
    reconciledRows.push({
      id: 2,
      accountId: 5,
      referenceType: 'CashflowTransaction',
      referenceId: 11,
    });

    await categorized([7]);

    expect(patch).not.toHaveBeenCalled();
  });

  it('does nothing when the bank rows were never reconciled', async () => {
    await categorized([99]);

    expect(patch).not.toHaveBeenCalled();
  });

  it('takes over on a match, mapping the stored reference type', async () => {
    matchedRows = [{ referenceType: 'ManualJournal', referenceId: 11 }];
    ledger = [{ type: 'Journal', id: 11 }];

    await subscriber.handleMatched({
      uncategorizedTransactionIds: [7],
      matchedTransactions: [
        { referenceType: 'ManualJournal', referenceId: 11 },
      ],
      trx,
    } as any);

    expect(patch).toHaveBeenCalledWith({
      referenceType: 'Journal',
      referenceId: 11,
    });
  });

  it('ignores a match that stored two distinct references', async () => {
    matchedRows = [
      { referenceType: 'Expense', referenceId: 11 },
      { referenceType: 'Expense', referenceId: 12 },
    ];
    ledger = [{ type: 'Expense', id: 11 }];

    await subscriber.handleMatched({
      uncategorizedTransactionIds: [7],
      matchedTransactions: [
        { referenceType: 'Expense', referenceId: 11 },
        { referenceType: 'Expense', referenceId: 12 },
      ],
      trx,
    } as any);

    expect(patch).not.toHaveBeenCalled();
  });
});
