import {
  BANK_AMOUNT_ERRORS,
  getBankAmountLayout,
  getColumnSignModes,
  getMappedAmountColumns,
  prepareBankRows,
  summarizeBankAmounts,
} from './bankImportAmounts';

const twoColumns = {
  layout: 'depositWithdrawal' as const,
  reverseSigns: false,
};
const amounts = (rows: Record<string, any>[]) =>
  prepareBankRows(rows, twoColumns).rows.map((row) => row.amount);

describe('getBankAmountLayout', () => {
  it('is the amount layout when Amount is mapped', () => {
    expect(getBankAmountLayout([{ to: 'date' }, { to: 'amount' }])).toBe(
      'amount',
    );
  });

  it('is the deposit/withdrawal layout when either column is mapped', () => {
    expect(getBankAmountLayout([{ to: 'date' }, { to: 'withdrawal' }])).toBe(
      'depositWithdrawal',
    );
    expect(getBankAmountLayout([{ to: 'deposit' }])).toBe('depositWithdrawal');
  });
});

describe('getMappedAmountColumns', () => {
  it('lists the deposit and withdrawal columns that are mapped', () => {
    expect(
      getMappedAmountColumns([{ to: 'date' }, { to: 'withdrawal' }]),
    ).toEqual(['withdrawal']);
    expect(
      getMappedAmountColumns([{ to: 'withdrawal' }, { to: 'deposit' }]),
    ).toEqual(['deposit', 'withdrawal']);
  });
});

describe('getColumnSignModes', () => {
  it('reads an all-negative column as positive', () => {
    expect(
      getColumnSignModes([{ withdrawal: -5 }, { withdrawal: -12 }]).withdrawal,
    ).toBe('negativesArePositive');
  });

  it('keeps signs as written in a mixed column', () => {
    expect(
      getColumnSignModes([{ withdrawal: 5 }, { withdrawal: -20 }]).withdrawal,
    ).toBe('asWritten');
  });

  it('keeps signs as written in an all-positive column', () => {
    expect(
      getColumnSignModes([{ withdrawal: 5 }, { withdrawal: 12 }]).withdrawal,
    ).toBe('asWritten');
  });

  it('keeps signs as written in an empty, zero or non-number column', () => {
    const modes = getColumnSignModes([
      { deposit: 0 },
      { deposit: undefined },
      { deposit: NaN },
      {},
    ]);
    expect(modes.deposit).toBe('asWritten');
    expect(modes.withdrawal).toBe('asWritten');
  });

  it('decides each column on its own', () => {
    expect(
      getColumnSignModes([
        { deposit: 100, withdrawal: undefined },
        { deposit: undefined, withdrawal: -5 },
      ]),
    ).toEqual({ deposit: 'asWritten', withdrawal: 'negativesArePositive' });
  });

  it('keeps an all-negative column read as positive when it also holds a non-number', () => {
    expect(
      getColumnSignModes([
        { withdrawal: -5 },
        { withdrawal: NaN },
        { withdrawal: -12 },
      ]).withdrawal,
    ).toBe('negativesArePositive');
  });
});

describe('prepareBankRows with deposit and withdrawal columns', () => {
  it('turns a deposit into money in and a withdrawal into money out', () => {
    expect(amounts([{ deposit: 100 }, { withdrawal: 5 }])).toEqual([100, -5]);
  });

  it('reads an all-negative withdrawal column as money out', () => {
    expect(amounts([{ withdrawal: -5 }, { withdrawal: -12 }])).toEqual([
      -5, -12,
    ]);
  });

  it('turns a refund in a purchases column into money in', () => {
    expect(amounts([{ withdrawal: 50 }, { withdrawal: -20 }])).toEqual([
      -50, 20,
    ]);
  });

  it('turns a negative deposit in a mixed column into money out', () => {
    expect(amounts([{ deposit: -30 }, { deposit: 100 }])).toEqual([-30, 100]);
  });

  it('treats a zero in the other column as empty', () => {
    expect(amounts([{ deposit: 0, withdrawal: 5 }])).toEqual([-5]);
  });

  it('removes the deposit and withdrawal keys from the rows', () => {
    const { rows } = prepareBankRows(
      [{ date: '2026-02-02', deposit: 100, withdrawal: 0 }],
      twoColumns,
    );
    expect(rows[0]).toEqual({ date: '2026-02-02', amount: 100 });
  });

  it('rejects a row with both a deposit and a withdrawal', () => {
    const { rows, rowErrors } = prepareBankRows(
      [{ deposit: 10, withdrawal: 5 }],
      twoColumns,
    );
    expect(rowErrors).toEqual([
      {
        index: 0,
        errorCode: BANK_AMOUNT_ERRORS.BOTH,
        errorMessage: 'This row has both a deposit and a withdrawal.',
      },
    ]);
    expect(rows[0].amount).toBeUndefined();
  });

  it('rejects a row with neither a deposit nor a withdrawal', () => {
    const { rowErrors } = prepareBankRows([{ deposit: 5 }, {}], twoColumns);
    expect(rowErrors).toEqual([
      {
        index: 1,
        errorCode: BANK_AMOUNT_ERRORS.NONE,
        errorMessage: 'This row has no deposit or withdrawal.',
      },
    ]);
  });

  it('names only the withdrawal column when it is the only one mapped', () => {
    const { rowErrors } = prepareBankRows([{}], {
      ...twoColumns,
      mappedColumns: ['withdrawal'],
    });
    expect(rowErrors[0].errorMessage).toBe('This row has no withdrawal.');
  });

  it('names only the deposit column when it is the only one mapped', () => {
    const { rowErrors } = prepareBankRows([{}], {
      ...twoColumns,
      mappedColumns: ['deposit'],
    });
    expect(rowErrors[0].errorMessage).toBe('This row has no deposit.');
  });

  it('rejects a value that is not a number, naming the column', () => {
    const { rowErrors } = prepareBankRows(
      [{ deposit: NaN }, { withdrawal: '(5.00)' }],
      twoColumns,
    );
    expect(rowErrors).toEqual([
      {
        index: 0,
        errorCode: BANK_AMOUNT_ERRORS.NOT_A_NUMBER,
        errorMessage: 'Deposit must be a number.',
      },
      {
        index: 1,
        errorCode: BANK_AMOUNT_ERRORS.NOT_A_NUMBER,
        errorMessage: 'Withdrawal must be a number.',
      },
    ]);
  });
});

describe('prepareBankRows with reverse signs', () => {
  it('negates the combined deposit/withdrawal amount', () => {
    const { rows } = prepareBankRows([{ deposit: 100 }, { withdrawal: 5 }], {
      layout: 'depositWithdrawal',
      reverseSigns: true,
    });
    expect(rows.map((row) => row.amount)).toEqual([-100, 5]);
  });

  it('negates a one-column amount and leaves a missing one missing', () => {
    const { rows, rowErrors } = prepareBankRows(
      [{ amount: 5 }, { amount: -100 }, { date: '2026-02-02' }],
      { layout: 'amount', reverseSigns: true },
    );
    expect(rows.map((row) => row.amount)).toEqual([-5, 100, undefined]);
    expect(rowErrors).toEqual([]);
  });
});

describe('prepareBankRows with one amount column and no options', () => {
  it('returns the rows unchanged', () => {
    const input = [
      { date: '2026-02-02', amount: -5, payee: 'Coffee' },
      { date: '2026-02-03', amount: 100 },
      { date: '2026-02-04' },
    ];
    const { rows, rowErrors } = prepareBankRows(input, {
      layout: 'amount',
      reverseSigns: false,
    });
    expect(rows).toEqual(input);
    expect(rowErrors).toEqual([]);
  });
});

describe('summarizeBankAmounts', () => {
  it('totals money in and money out to 2 decimals', () => {
    expect(summarizeBankAmounts([100, -5, -12.5, 20])).toEqual({
      moneyIn: 120,
      moneyOut: 17.5,
    });
  });

  it('ignores amounts that are not numbers', () => {
    expect(summarizeBankAmounts([0.1, 0.2, NaN, -0.3])).toEqual({
      moneyIn: 0.3,
      moneyOut: 0.3,
    });
  });
});
