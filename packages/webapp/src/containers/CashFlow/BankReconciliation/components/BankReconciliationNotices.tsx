import { Callout, Intent } from '@blueprintjs/core';
import React from 'react';
import intl from 'react-intl-universal';
import { Link } from 'react-router-dom';
import { formattedAmount } from '@/utils';

interface MismatchItem {
  referenceType: string;
  referenceId: number;
  amount: number;
  currentAmount: number;
  isDeleted: boolean;
  transactionType?: string | null;
  transactionNumber?: string | null;
}

export interface BankReconciliationNoticesProps {
  mismatch?: { amount: number; items: MismatchItem[] } | null;
  uncategorizedCount?: number | null;
  droppedCount?: number;
  accountId: number;
  // Used by the mismatch warning text.
  beginningBalance?: number;
  lastEndingBalance?: number | null;
  currencyCode?: string;
}

/**
 * Mismatch warning, uncategorized notice and dropped-from-draft notice,
 * shared by the start dialog and the Reconcile page.
 */
export function BankReconciliationNotices({
  mismatch,
  uncategorizedCount,
  droppedCount,
  accountId,
  beginningBalance,
  lastEndingBalance,
  currencyCode,
}: BankReconciliationNoticesProps) {
  const fmt = (amount: number) => formattedAmount(amount, currencyCode);

  return (
    <>
      {mismatch && (
        <Callout intent={Intent.WARNING} style={{ marginTop: 10 }}>
          <p>
            {intl.getHTML('bank_reconciliation.mismatch_warning', {
              amount: fmt(beginningBalance ?? 0),
              lastAmount: fmt(lastEndingBalance ?? 0),
            })}
          </p>
          <ul>
            {mismatch.items.map((item) => (
              <li key={`${item.referenceType}-${item.referenceId}`}>
                {[item.transactionType, item.transactionNumber]
                  .filter(Boolean)
                  .join(' ') || item.referenceType}
                : {fmt(item.amount)} {'→ '}
                {item.isDeleted ? 'deleted' : fmt(item.currentAmount)}
              </li>
            ))}
          </ul>
        </Callout>
      )}
      {!!uncategorizedCount && (
        <Callout intent={Intent.WARNING} style={{ marginTop: 10 }}>
          <Link
            to={`/cashflow-accounts/${accountId}/transactions?filter=uncategorized`}
          >
            {intl.get('bank_reconciliation.uncategorized_notice', {
              count: uncategorizedCount,
            })}
          </Link>
        </Callout>
      )}
      {!!droppedCount && (
        <Callout intent={Intent.PRIMARY} style={{ marginTop: 10 }}>
          {intl.get('bank_reconciliation.dropped_notice', {
            count: droppedCount,
          })}
        </Callout>
      )}
    </>
  );
}
