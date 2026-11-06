import { Alert, Button, Intent } from '@blueprintjs/core';
import React, { useCallback, useRef, useState } from 'react';
import intl from 'react-intl-universal';
import { useHistory } from 'react-router-dom';
import styled from 'styled-components';
import { BankReconciliationLeaveGuard } from './BankReconciliationLeaveGuard';
import { useBankReconciliationContext } from './BankReconciliationProvider';
import { getBankReconciliationErrorMessage, refKey } from './utils';
import { AppToaster } from '@/components';
import { PageForm } from '@/components/PageForm';
import {
  useFinishBankReconciliation,
  useSaveBankReconciliationDraft,
} from '@/hooks/query/banking';

// The page-form footer bar (light and dark theme colours), kept in view.
const Footer = styled(PageForm.FooterActions)`
  position: sticky;
  bottom: 0;
`;

export function BankReconciliationFooterActions() {
  const history = useHistory();
  const [isConfirmOpen, setConfirmOpen] = useState(false);
  // Set right before the page's own navigation, so the leave guard lets it go.
  const leaveAllowed = useRef(false);
  const isLeaveAllowed = useCallback(() => leaveAllowed.current, []);
  const {
    accountId,
    rows,
    selectedKeys,
    statementDate,
    endingBalance,
    header,
    isDirty,
    isTransactionsFetching,
    isTransactionsError,
    markSaved,
  } = useBankReconciliationContext();
  const { mutateAsync: saveDraft, isPending: isSaving } =
    useSaveBankReconciliationDraft();
  const { mutateAsync: finish, isPending: isFinishing } =
    useFinishBankReconciliation();

  const goToAccount = () => {
    leaveAllowed.current = true;
    history.replace(`/cashflow-accounts/${accountId}/transactions`);
  };

  const buildBody = () => ({
    statementDate,
    endingBalance,
    selectedTransactions: rows
      .filter((row) => selectedKeys.has(refKey(row)))
      .map(({ referenceType, referenceId }) => ({
        referenceType,
        referenceId,
      })),
  });

  const submit = async (
    action: typeof saveDraft | typeof finish,
    messageKey: string,
  ) => {
    try {
      await action({ accountId, body: buildBody() });
      markSaved();
      AppToaster.show({
        message: intl.get(messageKey),
        intent: Intent.SUCCESS,
      });
      goToAccount();
    } catch (error) {
      AppToaster.show({
        message: getBankReconciliationErrorMessage(error),
        intent: Intent.DANGER,
      });
    }
  };

  const busy =
    isSaving || isFinishing || isTransactionsFetching || isTransactionsError;

  return (
    <Footer spacing={10} position="right">
      <BankReconciliationLeaveGuard
        when={isDirty && !isSaving && !isFinishing}
        isLeaveAllowed={isLeaveAllowed}
      />
      <Button
        data-testid="reconcile-close"
        disabled={isSaving || isFinishing}
        onClick={() => (isDirty ? setConfirmOpen(true) : goToAccount())}
      >
        {intl.get('bank_reconciliation.close_without_saving')}
      </Button>
      <Button
        data-testid="reconcile-save"
        loading={isSaving}
        disabled={busy}
        onClick={() => submit(saveDraft, 'bank_reconciliation.saved_toast')}
      >
        {intl.get('bank_reconciliation.save_for_later')}
      </Button>
      <Button
        intent={Intent.PRIMARY}
        data-testid="reconcile-finish"
        loading={isFinishing}
        disabled={busy || header.difference !== 0}
        onClick={() => submit(finish, 'bank_reconciliation.finished_toast')}
      >
        {intl.get('bank_reconciliation.finish_now')}
      </Button>

      <Alert
        isOpen={isConfirmOpen}
        intent={Intent.DANGER}
        cancelButtonText={intl.get('cancel')}
        confirmButtonText={intl.get('bank_reconciliation.close_without_saving')}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => {
          setConfirmOpen(false);
          goToAccount();
        }}
      >
        <p>{intl.get('bank_reconciliation.close_confirm')}</p>
      </Alert>
    </Footer>
  );
}
