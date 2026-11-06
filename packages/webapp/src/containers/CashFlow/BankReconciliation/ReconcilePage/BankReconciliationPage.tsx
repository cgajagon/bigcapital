import React from 'react';
import { BankReconciliationNotices } from '../components/BankReconciliationNotices';
import { BankReconciliationEditInfoDialog } from './BankReconciliationEditInfoDialog';
import { BankReconciliationFooterActions } from './BankReconciliationFooterActions';
import { BankReconciliationHeader } from './BankReconciliationHeader';
import {
  BankReconciliationProvider,
  useBankReconciliationContext,
} from './BankReconciliationProvider';
import { BankReconciliationTable } from './BankReconciliationTable';
import { DashboardPageContent } from '@/components';
import { DialogsName } from '@/constants/dialogs';
import { CashFlowDrawers } from '@/containers/CashFlow/CashFlowDrawers';

/**
 * Notices from the summary queried with the statement date.
 */
function BankReconciliationPageNotices() {
  const { accountId, datedSummary, droppedCount, beginningBalance } =
    useBankReconciliationContext();
  if (!datedSummary) return null;

  const common = {
    accountId,
    uncategorizedCount: datedSummary.uncategorizedCount,
    droppedCount,
    currencyCode: datedSummary.account?.currencyCode,
  };
  // A mismatch always comes with a last reconciliation.
  if (datedSummary.mismatch && datedSummary.lastReconciliation) {
    return (
      <BankReconciliationNotices
        {...common}
        mismatch={datedSummary.mismatch}
        beginningBalance={beginningBalance}
        lastEndingBalance={datedSummary.lastReconciliation.endingBalance}
      />
    );
  }
  return <BankReconciliationNotices {...common} />;
}

/**
 * Bank reconciliation page: `/cashflow-accounts/:id/reconcile`.
 */
export default function BankReconciliationPage() {
  return (
    <BankReconciliationProvider>
      <CashFlowDrawers />
      <DashboardPageContent>
        <div style={{ padding: '0 15px' }}>
          <BankReconciliationPageNotices />
        </div>
        <BankReconciliationHeader />
        <BankReconciliationTable />
      </DashboardPageContent>
      <BankReconciliationFooterActions />
      <BankReconciliationEditInfoDialog
        dialogName={DialogsName.BankReconciliationEditInfo}
      />
    </BankReconciliationProvider>
  );
}
