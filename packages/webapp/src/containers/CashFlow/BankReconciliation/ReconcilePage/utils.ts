import intl from 'react-intl-universal';
import type { BankReconciliationTransactionsResponse } from '@bigcapital/sdk-ts';

export type BankReconciliationRow =
  BankReconciliationTransactionsResponse['transactions'][number];

export type BankReconciliationTab = 'payments' | 'deposits' | 'all';

export interface BankReconciliationFilters {
  tab: BankReconciliationTab;
  showAfterStatementDate: boolean;
  search: string;
}

/**
 * Row key. Same format as the server's `refKey` (`_utils.ts`), used for
 * `getRowId` and for the selected set.
 */
export const refKey = (ref: {
  referenceType: string;
  referenceId: number;
}): string => `${ref.referenceType}-${ref.referenceId}`;

/**
 * Rounds to 2 decimals, half away from zero. Mirrors the server's
 * `roundAmount`, so "difference = 0" agrees on both sides.
 */
export const roundAmount = (value: number): number => {
  const abs = Math.abs(value);
  const scaled = Number((abs * 100).toPrecision(15));
  const rounded = Math.round(scaled) / 100;
  return value < 0 && rounded !== 0 ? -rounded : rounded;
};

/**
 * Cleared balance and difference. Each amount is rounded to cents BEFORE it
 * is summed, as the server does. Rows hidden by a filter still count when
 * ticked, because the selection is not tied to what is visible.
 */
export function computeHeader(
  beginningBalance: number,
  rows: BankReconciliationRow[],
  selectedKeys: Set<string>,
  endingBalance: number,
) {
  let increases = 0;
  let decreases = 0;
  for (const row of rows) {
    if (!selectedKeys.has(refKey(row))) continue;
    const amount = roundAmount(Number(row.amount));
    if (amount > 0) increases += amount;
    else decreases += -amount;
  }
  increases = roundAmount(increases);
  decreases = roundAmount(decreases);
  const clearedBalance = roundAmount(
    roundAmount(beginningBalance) + increases - decreases,
  );
  const difference = roundAmount(roundAmount(endingBalance) - clearedBalance);
  return { clearedBalance, difference, increases, decreases };
}

/**
 * Applies the tab, the after-statement-date switch and the text search.
 * Payments are `amount < 0`; deposits (credit card: charges) `amount > 0`.
 */
export function filterRows(
  rows: BankReconciliationRow[],
  { tab, showAfterStatementDate, search }: BankReconciliationFilters,
): BankReconciliationRow[] {
  const needle = search.trim().toLowerCase();
  return rows.filter((row) => {
    if (!showAfterStatementDate && row.isAfterStatementDate) return false;
    if (tab === 'payments' && !(row.amount < 0)) return false;
    if (tab === 'deposits' && !(row.amount > 0)) return false;
    if (!needle) return true;
    return [
      row.transactionType,
      row.transactionNumber,
      row.referenceNumber,
      row.contactName,
      row.description,
    ].some((value) => (value ?? '').toLowerCase().includes(needle));
  });
}

/**
 * New selection after the user changed the VISIBLE rows' ticks:
 * (selected minus visible) union selectedVisible. Ticks on rows hidden by a
 * tab, the search or the after-date switch survive.
 */
export function mergeSelection(
  selectedKeys: Set<string>,
  visibleKeys: string[],
  selectedVisibleKeys: string[],
): Set<string> {
  const next = new Set(selectedKeys);
  visibleKeys.forEach((key) => next.delete(key));
  selectedVisibleKeys.forEach((key) => next.add(key));
  return next;
}

/** Stable text form of the editable state, to detect unsaved changes. */
export const stateSignature = (
  statementDate: string,
  endingBalance: number,
  selectedKeys: Set<string>,
): string =>
  JSON.stringify([statementDate, endingBalance, [...selectedKeys].sort()]);

const ERROR_KEYS: Record<string, string> = {
  BANK_RECONCILIATION_ACCOUNT_NOT_RECONCILABLE:
    'bank_reconciliation.error.account_not_reconcilable',
  BANK_RECONCILIATION_FOREIGN_CURRENCY:
    'bank_reconciliation.foreign_currency_disabled',
  BANK_RECONCILIATION_STATEMENT_DATE_NOT_AFTER_LAST:
    'bank_reconciliation.error.statement_date_not_after_last',
  BANK_RECONCILIATION_TRANSACTION_NOT_ON_ACCOUNT:
    'bank_reconciliation.error.transaction_not_on_account',
  BANK_RECONCILIATION_TRANSACTION_ALREADY_RECONCILED:
    'bank_reconciliation.error.transaction_already_reconciled',
  BANK_RECONCILIATION_DIFFERENCE_NOT_ZERO:
    'bank_reconciliation.error.difference_not_zero',
  BANK_RECONCILIATION_NOT_FOUND: 'bank_reconciliation.error.not_found',
};

/**
 * Readable message for a failed save/finish request: a mapped
 * `BANK_RECONCILIATION_*` code, else the server's message, else a generic one.
 */
export function getBankReconciliationErrorMessage(error: unknown): string {
  // The sdk-ts fetcher rejects with an `ApiError` that carries `data`.
  const data = (
    error as { data?: { errors?: { type?: string; message?: string }[] } }
  )?.data;
  const first = data?.errors?.[0];
  const key = first?.type ? ERROR_KEYS[first.type] : undefined;
  if (key) return intl.get(key);
  return first?.message || intl.get('bank_reconciliation.error.generic');
}

/** True when the amount has more than 2 decimal places. */
export const hasTooManyDecimals = (value: string | number): boolean =>
  !/^-?\d*(\.\d{0,2})?$/.test(String(value).trim());
