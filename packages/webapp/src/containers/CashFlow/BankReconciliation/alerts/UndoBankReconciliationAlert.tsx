import { Alert, Intent } from '@blueprintjs/core';
import * as FF from 'fp-ts/function';
import React from 'react';
import intl from 'react-intl-universal';
import { getBankReconciliationErrorMessage } from '../ReconcilePage/utils';
import type { WithAlertActionsProps } from '@/containers/Alert/withAlertActions';
import type { WithAlertStoreConnectProps } from '@/containers/Alert/withAlertStoreConnect';
import { AppToaster } from '@/components';
import { DRAWERS } from '@/constants/drawers';
import { withAlertActions } from '@/containers/Alert/withAlertActions';
import { withAlertStoreConnect } from '@/containers/Alert/withAlertStoreConnect';
import { useUndoBankReconciliation } from '@/hooks/query/banking';
import { useDrawerActions } from '@/hooks/state';

interface UndoBankReconciliationAlertProps
  extends Pick<WithAlertActionsProps, 'closeAlert'>,
    WithAlertStoreConnectProps {
  name: string;
}

/**
 * Undo a bank reconciliation (and every later one) alert.
 */
function UndoBankReconciliationAlertInner({
  name,

  // #withAlertStoreConnect
  isOpen,
  payload,

  // #withAlertActions
  closeAlert,
}: UndoBankReconciliationAlertProps) {
  const { mutateAsync: undo, isPending } = useUndoBankReconciliation();
  const { closeDrawer } = useDrawerActions();

  const reconciliationId = payload?.reconciliationId as number;
  const count = (payload?.count as number | undefined) ?? 1;
  const remaining = (payload?.remaining as number | undefined) ?? 1;

  const handleConfirm = () => {
    undo(reconciliationId)
      .then(() => {
        AppToaster.show({
          message: intl.get('bank_reconciliation.undone_toast'),
          intent: Intent.SUCCESS,
        });
        closeAlert(name);
        // The drawer falls back to the list by itself; close it if empty.
        if (remaining <= 0) closeDrawer(DRAWERS.BANK_RECONCILIATION_HISTORY);
      })
      .catch((error) => {
        AppToaster.show({
          message: getBankReconciliationErrorMessage(error),
          intent: Intent.DANGER,
        });
        closeAlert(name);
      });
  };

  return (
    <Alert
      cancelButtonText={intl.get('cancel')}
      confirmButtonText={intl.get('bank_reconciliation.undo')}
      intent={Intent.DANGER}
      isOpen={isOpen}
      onCancel={() => closeAlert(name)}
      loading={isPending}
      onConfirm={handleConfirm}
    >
      <p>{intl.get('bank_reconciliation.undo_confirm', { count })}</p>
      <p>{intl.get('bank_reconciliation.undo_draft_note')}</p>
    </Alert>
  );
}

export const UndoBankReconciliationAlert = FF.pipe(
  UndoBankReconciliationAlertInner,
  withAlertActions,
  withAlertStoreConnect(),
);
