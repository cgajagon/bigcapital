import { useCallback } from 'react';
import { roundAmount } from './ReconcilePage/utils';
import { useDateInputFormatter } from '@/hooks';
import { formattedAmount } from '@/utils';

/**
 * Money with the minus sign before the currency symbol ("-$1,250.00");
 * `formattedAmount` alone renders negatives as "$-1,250.00".
 */
export const formatSignedAmount = (
  amount: number,
  currencyCode?: string,
): string =>
  roundAmount(Number(amount)) < 0
    ? `-${formattedAmount(Math.abs(Number(amount)), currencyCode)}`
    : formattedAmount(Number(amount), currencyCode);

/**
 * Formats a date with the organization's date format, the one the
 * transaction rows use. An empty date renders as `—`.
 */
export function useBankReconciliationDateFormat() {
  const { formatDate } = useDateInputFormatter();
  return useCallback(
    (date?: string | null): string => (date ? formatDate(date) : '—'),
    [formatDate],
  );
}
