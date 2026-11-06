import { Alert, Button, Intent } from '@blueprintjs/core';
import React, { useState } from 'react';
import intl from 'react-intl-universal';
import { useHistory } from 'react-router-dom';
import styled from 'styled-components';
import { useBankReconciliationContext } from './BankReconciliationProvider';
import { getBankReconciliationErrorMessage, refKey } from './utils';
import { AppToaster } from '@/components';
import {
  useFinishBankReconciliation,
  useSaveBankReconciliationDraft,
} from '@/hooks/query/banking';

const Footer = styled.div`
  position: sticky;
  bottom: 0;
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding: 12px 15px;
  background: var(--color-dashboard-background, #fff);
  border-top: 1px solid rgba(128, 128, 128, 0.3);
`;

export function BankReconciliationFooterActions() {
  const history = useHistory();
  const [isConfirmOpen, setConfirmOpen] = useState(false);
  const {
    accountId,
    rows,
    selectedKeys,
    statementDate,
    endingBalance,
    header,
    isDirty,
    isTransactionsFetching,
    markSaved,
  } = useBankReconciliationContext();
  const { mutateAsync: saveDraft, isPending: isSaving } =
    useSaveBankReconciliationDraft();
  const { mutateAsync: finish, isPending: isFinishing } =
    useFinishBankReconciliation();

  const goToAccount = () =>
    history.push(`/cashflow-accounts/${accountId}/transactions`);

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

  const busy = isSaving || isFinishing || isTransactionsFetching;

  return (
    <Footer>
      <Button
        data-testid="reconcile-close"
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
