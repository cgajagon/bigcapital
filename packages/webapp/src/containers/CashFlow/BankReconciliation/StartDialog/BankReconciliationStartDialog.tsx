import * as FF from 'fp-ts/function';
import React from 'react';
import intl from 'react-intl-universal';
import type { DialogBaseProps } from '@/components/DialogReduxConnect';
import { Dialog, DialogSuspense } from '@/components';
import withDialogRedux from '@/components/DialogReduxConnect';

const BankReconciliationStartDialogContent = React.lazy(() =>
  import('./BankReconciliationStartDialogContent').then((m) => ({
    default: m.BankReconciliationStartDialogContent as React.ComponentType<{
      dialogName?: string;
      accountId: number;
    }>,
  })),
);

interface BankReconciliationStartDialogProps extends DialogBaseProps {
  dialogName: string;
}

/**
 * Bank reconciliation start dialog.
 */
function BankReconciliationStartDialogRoot({
  dialogName,
  payload,
  isOpen,
}: BankReconciliationStartDialogProps) {
  const accountId = payload?.accountId as number;

  return (
    <Dialog
      name={dialogName}
      title={intl.get('bank_reconciliation.reconcile')}
      isOpen={isOpen}
      canEscapeJeyClose={true}
      autoFocus={true}
      style={{ width: 460 }}
    >
      <DialogSuspense>
        <BankReconciliationStartDialogContent
          dialogName={dialogName}
          accountId={accountId}
        />
      </DialogSuspense>
    </Dialog>
  );
}

export const BankReconciliationStartDialog = FF.pipe(
  BankReconciliationStartDialogRoot,
  withDialogRedux(),
);

BankReconciliationStartDialog.displayName = 'BankReconciliationStartDialog';
