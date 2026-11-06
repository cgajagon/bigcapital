import * as FF from 'fp-ts/function';
import React from 'react';
import { Drawer, DrawerSuspense } from '@/components';
import { withDrawers, WithDrawersProps } from '@/containers/Drawer/withDrawers';

const BankReconciliationHistoryContent = React.lazy(() =>
  import('./BankReconciliationHistoryContent').then((m) => ({
    default: m.BankReconciliationHistoryContent,
  })),
);

interface BankReconciliationHistoryDrawerProps extends WithDrawersProps {
  name: string;
}

/**
 * Bank reconciliation history drawer.
 */
function BankReconciliationHistoryDrawer({
  name,
  // #withDrawers
  isOpen,
  payload,
}: BankReconciliationHistoryDrawerProps) {
  const accountId = payload?.accountId as number | undefined;

  return (
    <Drawer
      isOpen={isOpen}
      name={name}
      size={'65%'}
      style={{ minWidth: '700px', maxWidth: '900px' }}
    >
      <DrawerSuspense>
        <BankReconciliationHistoryContent accountId={accountId} />
      </DrawerSuspense>
    </Drawer>
  );
}

export const index = FF.pipe(BankReconciliationHistoryDrawer, withDrawers());
