import { Button, Callout, Intent } from '@blueprintjs/core';
import React from 'react';
import intl from 'react-intl-universal';
import { Link } from 'react-router-dom';
import { DRAWERS } from '@/constants/drawers';
import { handleViewTransactionDetail } from '@/containers/FinancialStatements/utils/transactionDrawer';
import { useDrawerActions } from '@/hooks/state';
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

interface NoticesBaseProps {
  uncategorizedCount?: number | null;
  droppedCount?: number;
  accountId: number;
  currencyCode?: string;
  // Called before a notice link navigates or opens a drawer.
  onNavigate?: () => void;
}

interface NoticesWithMismatchProps extends NoticesBaseProps {
  mismatch: { amount: number; items: MismatchItem[] };
  // Used by the mismatch warning text.
  beginningBalance: number;
  lastEndingBalance: number;
}

interface NoticesWithoutMismatchProps extends NoticesBaseProps {
  mismatch?: null;
  beginningBalance?: number;
  lastEndingBalance?: number | null;
}

export type BankReconciliationNoticesProps =
  | NoticesWithMismatchProps
  | NoticesWithoutMismatchProps;

/**
 * Mismatch warning, uncategorized notice and dropped-from-draft notice,
 * shared by the start dialog and the Reconcile page.
 */
export function BankReconciliationNotices(
  props: BankReconciliationNoticesProps,
) {
  const { uncategorizedCount, droppedCount, accountId, currencyCode } = props;
  const { onNavigate } = props;
  const { openDrawer } = useDrawerActions();
  const fmt = (amount: number) => formattedAmount(amount, currencyCode);

  const handleItemClick = (item: MismatchItem) => {
    onNavigate?.();
    handleViewTransactionDetail(
      { referenceType: item.referenceType, referenceId: item.referenceId },
      openDrawer,
      DRAWERS.CASHFLOW_TRNASACTION_DETAILS,
    );
  };

  return (
    <>
      {props.mismatch && (
        <Callout intent={Intent.WARNING} style={{ marginTop: 10 }}>
          <p>
            {intl.getHTML('bank_reconciliation.mismatch_warning', {
              amount: fmt(props.beginningBalance as number),
              lastAmount: fmt(props.lastEndingBalance as number),
            })}
          </p>
          <ul>
            {props.mismatch.items.map((item) => {
              const label =
                [item.transactionType, item.transactionNumber]
                  .filter(Boolean)
                  .join(' ') || item.referenceType;
              return (
                <li key={`${item.referenceType}-${item.referenceId}`}>
                  {item.isDeleted ? (
                    label
                  ) : (
                    <Button
                      minimal
                      small
                      intent={Intent.PRIMARY}
                      onClick={() => handleItemClick(item)}
                    >
                      {label}
                    </Button>
                  )}
                  : {fmt(item.amount)} {'→ '}
                  {item.isDeleted
                    ? intl.get('bank_reconciliation.deleted')
                    : fmt(item.currentAmount)}
                </li>
              );
            })}
          </ul>
        </Callout>
      )}
      {!!uncategorizedCount && (
        <Callout intent={Intent.WARNING} style={{ marginTop: 10 }}>
          <Link
            to={`/cashflow-accounts/${accountId}/transactions?filter=uncategorized`}
            onClick={onNavigate}
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
