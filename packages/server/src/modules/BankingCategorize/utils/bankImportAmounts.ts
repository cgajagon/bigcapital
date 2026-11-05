import { round } from 'lodash';

/**
 * How a bank statement file gives its amounts: one signed Amount column, or
 * separate Deposit and Withdrawal columns.
 */
export type BankAmountLayout = 'amount' | 'depositWithdrawal';

/**
 * How a Deposit or Withdrawal column writes its numbers. A column whose values
 * are all negative is a bank writing it with minus signs; otherwise the signs
 * mean something (a negative withdrawal is money back, like a refund).
 */
export type ColumnSignMode = 'asWritten' | 'negativesArePositive';

export interface BankRowError {
  index: number;
  errorCode: string;
  errorMessage: string;
}

export const BANK_AMOUNT_ERRORS = {
  BOTH: 'BankAmountBothColumns',
  NONE: 'BankAmountMissing',
  NOT_A_NUMBER: 'BankAmountNotANumber',
};

const COLUMNS = [
  { key: 'deposit', label: 'Deposit' },
  { key: 'withdrawal', label: 'Withdrawal' },
] as const;

type ColumnKey = (typeof COLUMNS)[number]['key'];

const isEmptyValue = (value: unknown) =>
  value === undefined || value === null || value === '' || value === 0;

const isNumberValue = (value: unknown): value is number =>
  typeof value === 'number' && !Number.isNaN(value);

/**
 * Retrieves the layout from the import's column mapping.
 * @param {Array<{ to: string }>} mapping
 * @returns {BankAmountLayout}
 */
export const getBankAmountLayout = (
  mapping: Array<{ to: string }>,
): BankAmountLayout =>
  mapping.some((map) => map.to === 'deposit' || map.to === 'withdrawal')
    ? 'depositWithdrawal'
    : 'amount';

/**
 * Decides, over the whole file, how each column writes its numbers.
 * @param {Record<string, any>[]} rows
 */
export const getColumnSignModes = (
  rows: Record<string, any>[],
): Record<ColumnKey, ColumnSignMode> => {
  const modeOf = (key: ColumnKey): ColumnSignMode => {
    const values = rows
      .map((row) => row[key])
      .filter((value) => isNumberValue(value) && value !== 0);

    return values.length > 0 && values.every((value) => value < 0)
      ? 'negativesArePositive'
      : 'asWritten';
  };
  return { deposit: modeOf('deposit'), withdrawal: modeOf('withdrawal') };
};

/**
 * Turns each parsed bank row into one signed `amount`: deposit minus
 * withdrawal (by each column's sign mode), negated when `reverseSigns` is set.
 * Rows that can't give an amount are reported in `rowErrors`.
 * @param {Record<string, any>[]} rows - Parsed rows, in file order.
 * @param {{ layout: BankAmountLayout; reverseSigns: boolean }} options
 */
export const prepareBankRows = (
  rows: Record<string, any>[],
  options: { layout: BankAmountLayout; reverseSigns: boolean },
): { rows: Record<string, any>[]; rowErrors: BankRowError[] } => {
  const sign = options.reverseSigns ? -1 : 1;

  if (options.layout === 'amount') {
    if (!options.reverseSigns) return { rows, rowErrors: [] };

    const reversed = rows.map((row) =>
      isNumberValue(row.amount) ? { ...row, amount: -row.amount } : row,
    );
    return { rows: reversed, rowErrors: [] };
  }
  const modes = getColumnSignModes(rows);
  const rowErrors: BankRowError[] = [];

  const prepared = rows.map((row, index) => {
    const { deposit, withdrawal, ...rest } = row;
    const values: Record<ColumnKey, unknown> = { deposit, withdrawal };
    const error = (errorCode: string, errorMessage: string) => {
      rowErrors.push({ index, errorCode, errorMessage });
      return rest;
    };
    const invalid = COLUMNS.find(
      ({ key }) => !isEmptyValue(values[key]) && !isNumberValue(values[key]),
    );
    if (invalid) {
      return error(
        BANK_AMOUNT_ERRORS.NOT_A_NUMBER,
        `${invalid.label} must be a number.`,
      );
    }
    const [depositValue, withdrawalValue] = COLUMNS.map(({ key }) => {
      const value = isEmptyValue(values[key]) ? 0 : (values[key] as number);
      return modes[key] === 'negativesArePositive' ? Math.abs(value) : value;
    });
    if (depositValue !== 0 && withdrawalValue !== 0) {
      return error(
        BANK_AMOUNT_ERRORS.BOTH,
        'This row has both a deposit and a withdrawal.',
      );
    }
    if (depositValue === 0 && withdrawalValue === 0) {
      return error(
        BANK_AMOUNT_ERRORS.NONE,
        'This row has no deposit or withdrawal.',
      );
    }
    return { ...rest, amount: sign * (depositValue - withdrawalValue) };
  });
  return { rows: prepared, rowErrors };
};

/**
 * Totals the money in and money out of the given signed amounts.
 * @param {number[]} amounts
 * @returns {{ moneyIn: number; moneyOut: number }}
 */
export const summarizeBankAmounts = (
  amounts: number[],
): { moneyIn: number; moneyOut: number } => {
  const numbers = amounts.filter(isNumberValue);
  const moneyIn = numbers.filter((n) => n > 0).reduce((a, n) => a + n, 0);
  const moneyOut = numbers.filter((n) => n < 0).reduce((a, n) => a - n, 0);

  return { moneyIn: round(moneyIn, 2), moneyOut: round(moneyOut, 2) };
};
