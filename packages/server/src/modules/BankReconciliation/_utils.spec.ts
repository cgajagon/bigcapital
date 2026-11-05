import {
  DBError,
  ForeignKeyViolationError,
  UniqueViolationError,
} from 'objection';
import {
  computeClearedBalance,
  computeDifference,
  findChangedReconciled,
  netAmountOnAccount,
  preselectRefs,
  isDuplicateEntryError,
  resolveReconcileStatus,
  roundAmount,
  selectReconciliationsToUndo,
  shouldTakeOver,
  toLedgerReferenceType,
  validateAccount,
  validateFinish,
  validateStatementDate,
} from './_utils';
import { ERRORS, FinishCheckInput } from './types';

describe('roundAmount', () => {
  it('rounds half away from zero', () => {
    expect(roundAmount(1.005)).toBe(1.01);
    expect(roundAmount(-1.005)).toBe(-1.01);
    expect(roundAmount(2.004)).toBe(2);
  });
});

describe('netAmountOnAccount', () => {
  it('ignores cash-basis rows (payment settling two invoices)', () => {
    const lines = [
      { debit: 1200, credit: 0, basis: 'accrual' },
      { debit: 1000, credit: 0, basis: 'cash' },
      { debit: 200, credit: 0, basis: 'cash' },
    ];
    expect(netAmountOnAccount(lines as any, 'debit')).toBe(1200);
  });
  it('counts general (null basis) rows and nets debits against credits', () => {
    expect(
      netAmountOnAccount(
        [
          { debit: 50, credit: 0, basis: null },
          { debit: 0, credit: 20, basis: null },
        ],
        'debit',
      ),
    ).toBe(30);
  });
  it('flips the sign for credit-normal accounts (credit card charge is positive)', () => {
    expect(
      netAmountOnAccount([{ debit: 0, credit: 75.5, basis: null }], 'credit'),
    ).toBe(75.5);
  });
  it('rounds each transaction to cents', () => {
    expect(
      netAmountOnAccount([{ debit: 10.004, credit: 0, basis: null }], 'debit'),
    ).toBe(10);
  });
});

describe('difference', () => {
  it('is zero when beginning + selected equals ending', () => {
    const cleared = computeClearedBalance(100, [50, -30.25]);
    expect(cleared).toBe(119.75);
    expect(computeDifference(119.75, cleared)).toBe(0);
  });
});

describe('validateStatementDate', () => {
  it('requires a date strictly after the last statement', () => {
    expect(validateStatementDate('2026-01-31', '2026-01-31')).toBe(
      ERRORS.STATEMENT_DATE_NOT_AFTER_LAST,
    );
    expect(validateStatementDate('2026-02-28', '2026-01-31')).toBeNull();
    expect(validateStatementDate('2026-01-31', null)).toBeNull();
  });
});

describe('validateAccount', () => {
  it('accepts bank, cash and credit-card in base currency only', () => {
    expect(validateAccount('credit-card', 'CAD', 'CAD')).toBeNull();
    expect(validateAccount('expense', 'CAD', 'CAD')).toBe(
      ERRORS.ACCOUNT_NOT_RECONCILABLE,
    );
    expect(validateAccount('bank', 'USD', 'CAD')).toBe(ERRORS.FOREIGN_CURRENCY);
  });
});

describe('validateFinish', () => {
  const base = (over: Partial<FinishCheckInput> = {}): FinishCheckInput => ({
    accountType: 'bank',
    accountCurrency: 'CAD',
    baseCurrency: 'CAD',
    statementDate: '2026-01-31',
    lastStatementDate: null,
    beginningBalance: 0,
    endingBalance: 70,
    selected: [
      { referenceType: 'A', referenceId: 1 },
      { referenceType: 'B', referenceId: 2 },
    ],
    eligibleAmounts: new Map([
      ['A-1', 100],
      ['B-2', -30],
    ]),
    reconciledKeys: new Set<string>(),
    ...over,
  });

  it('passes at zero difference', () => {
    expect(validateFinish(base())).toBeNull();
  });
  it('rejects a non-zero difference', () => {
    expect(validateFinish(base({ endingBalance: 70.01 }))).toBe(
      ERRORS.DIFFERENCE_NOT_ZERO,
    );
  });
  it('rejects a selected transaction not on the account', () => {
    expect(
      validateFinish(
        base({
          selected: [
            { referenceType: 'A', referenceId: 1 },
            { referenceType: 'C', referenceId: 3 },
          ],
        }),
      ),
    ).toBe(ERRORS.TRANSACTION_NOT_ON_ACCOUNT);
  });
  it('rejects an already reconciled transaction', () => {
    expect(validateFinish(base({ reconciledKeys: new Set(['A-1']) }))).toBe(
      ERRORS.TRANSACTION_ALREADY_RECONCILED,
    );
  });
  it('checks the account before anything else', () => {
    expect(
      validateFinish(base({ accountType: 'income', endingBalance: 1 })),
    ).toBe(ERRORS.ACCOUNT_NOT_RECONCILABLE);
  });
});

describe('findChangedReconciled', () => {
  it('lists amount changes and deletions, not unchanged rows', () => {
    const snap = (type: string, id: number, amount: number) => ({
      referenceType: type,
      referenceId: id,
      reconciliationId: 1,
      amount,
      date: '2026-01-01',
      transactionTypeKey: null,
      transactionNumber: null,
      referenceNumber: null,
      contactName: null,
    });
    const result = findChangedReconciled(
      [snap('A', 1, 100), snap('B', 2, 50), snap('C', 3, 20)],
      new Map([
        ['A-1', 100],
        ['B-2', 45],
      ]),
    );
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      referenceType: 'B',
      referenceId: 2,
      currentAmount: 45,
      isDeleted: false,
    });
    expect(result[1]).toMatchObject({
      referenceType: 'C',
      referenceId: 3,
      currentAmount: 0,
      isDeleted: true,
    });
  });
});

describe('selectReconciliationsToUndo', () => {
  it('returns the target and every later reconciliation', () => {
    const list = [
      { id: 1, statementDate: '2026-01-31' },
      { id: 2, statementDate: '2026-02-28' },
      { id: 3, statementDate: '2026-03-31' },
    ];
    expect(selectReconciliationsToUndo(list, 2).sort()).toEqual([2, 3]);
    expect(selectReconciliationsToUndo(list, 3)).toEqual([3]);
    expect(selectReconciliationsToUndo(list, 99)).toEqual([]);
  });
});

describe('shouldTakeOver', () => {
  const args = {
    storedBankRowIds: [1, 2],
    linkedBankRowIds: [2, 1],
    oldTransactionOnAccount: false,
    newTransactionOnAccount: true,
    newTransactionReconciled: false,
  };
  it('takes over when all stored bank rows are relinked to one new transaction', () => {
    expect(shouldTakeOver(args)).toBe(true);
  });
  it('does not take over on a partial relink', () => {
    expect(shouldTakeOver({ ...args, linkedBankRowIds: [1] })).toBe(false);
  });
  it('does not take over while the old transaction still exists', () => {
    expect(shouldTakeOver({ ...args, oldTransactionOnAccount: true })).toBe(
      false,
    );
  });
  it('does not take over onto an already reconciled transaction', () => {
    expect(shouldTakeOver({ ...args, newTransactionReconciled: true })).toBe(
      false,
    );
  });
});

describe('resolveReconcileStatus', () => {
  it('R beats C; C from the bank feed or a draft tick; else none', () => {
    const sets = (o: any = {}) => ({
      reconciled: new Set<string>(),
      draftSelected: new Set<string>(),
      fromBankFeed: new Set<string>(),
      ...o,
    });
    expect(
      resolveReconcileStatus(
        'A-1',
        sets({
          reconciled: new Set(['A-1']),
          draftSelected: new Set(['A-1']),
          fromBankFeed: new Set(['A-1']),
        }),
      ),
    ).toBe('reconciled');
    expect(
      resolveReconcileStatus('A-1', sets({ fromBankFeed: new Set(['A-1']) })),
    ).toBe('cleared');
    expect(
      resolveReconcileStatus('A-1', sets({ draftSelected: new Set(['A-1']) })),
    ).toBe('cleared');
    expect(resolveReconcileStatus('A-1', sets())).toBe('none');
  });
});

describe('preselectRefs', () => {
  const rows = [
    {
      referenceType: 'A',
      referenceId: 1,
      date: '2026-01-20',
      isFromBankFeed: true,
    },
    {
      referenceType: 'B',
      referenceId: 2,
      date: '2026-02-05',
      isFromBankFeed: true,
    },
    {
      referenceType: 'C',
      referenceId: 3,
      date: '2026-01-10',
      isFromBankFeed: false,
    },
  ];
  it('ticks bank-feed rows dated on or before the statement date when there is no draft', () => {
    expect(preselectRefs(rows, '2026-01-31', null)).toEqual({
      selected: [{ referenceType: 'A', referenceId: 1 }],
      droppedCount: 0,
    });
  });
  it('uses the draft selection when there is one and counts ticks that no longer exist', () => {
    expect(
      preselectRefs([rows[0]], '2026-01-31', [
        { referenceType: 'A', referenceId: 1 },
        { referenceType: 'Z', referenceId: 9 },
      ]),
    ).toEqual({
      selected: [{ referenceType: 'A', referenceId: 1 }],
      droppedCount: 1,
    });
  });
});

describe('toLedgerReferenceType', () => {
  it('maps the matching type of manual journals to the ledger type', () => {
    expect(toLedgerReferenceType('ManualJournal')).toBe('Journal');
  });

  it('returns every other type unchanged', () => {
    expect(toLedgerReferenceType('PaymentReceive')).toBe('PaymentReceive');
    expect(toLedgerReferenceType('CashflowTransaction')).toBe(
      'CashflowTransaction',
    );
  });
});

describe('isDuplicateEntryError', () => {
  it('recognises a MySQL duplicate key error', () => {
    expect(isDuplicateEntryError({ code: 'ER_DUP_ENTRY', errno: 1062 })).toBe(
      true,
    );
    expect(isDuplicateEntryError({ errno: 1062 })).toBe(true);
  });

  it('recognises the error Objection wraps a duplicate key into', () => {
    const native = Object.assign(new Error('Duplicate entry'), {
      code: 'ER_DUP_ENTRY',
      errno: 1062,
    });
    const wrapped = new UniqueViolationError(<any>{
      nativeError: native,
      client: 'mysql',
      table: 'bank_reconciliation_transactions',
      columns: ['reference_type', 'reference_id'],
      constraint: 'uniq',
    });
    expect(isDuplicateEntryError(wrapped)).toBe(true);
    // Wrapped but not typed: found through the native error.
    expect(
      isDuplicateEntryError(
        new DBError(<any>{ nativeError: native, client: 'mysql' }),
      ),
    ).toBe(true);
  });

  it('ignores other wrapped errors', () => {
    const native = Object.assign(new Error('fk'), {
      code: 'ER_NO_REFERENCED_ROW_2',
      errno: 1452,
    });
    expect(
      isDuplicateEntryError(
        new ForeignKeyViolationError(<any>{
          nativeError: native,
          client: 'mysql',
          table: 't',
          constraint: 'c',
        }),
      ),
    ).toBe(false);
    expect(
      isDuplicateEntryError(
        new DBError(<any>{ nativeError: native, client: 'mysql' }),
      ),
    ).toBe(false);
  });

  it('ignores other errors', () => {
    expect(isDuplicateEntryError(new Error('boom'))).toBe(false);
    expect(isDuplicateEntryError({ code: 'ER_LOCK_DEADLOCK' })).toBe(false);
    expect(isDuplicateEntryError(undefined)).toBe(false);
  });
});
