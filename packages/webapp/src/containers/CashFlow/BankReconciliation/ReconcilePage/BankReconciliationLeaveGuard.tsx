import React, { useEffect } from 'react';
import intl from 'react-intl-universal';
import { Prompt } from 'react-router-dom';

interface BankReconciliationLeaveGuardProps {
  // There are unsaved changes and nothing is being submitted.
  when: boolean;
  // True once the page itself navigates away on purpose (after a save, a
  // finish or a confirmed close); read at navigation time, so it holds even
  // before React re-renders with the saved state.
  isLeaveAllowed: () => boolean;
}

/**
 * Asks before leaving the Reconcile page with unsaved ticks: in-app
 * navigation (back button, links) through react-router's `Prompt`, and
 * reloads or tab closes through `beforeunload`.
 */
export function BankReconciliationLeaveGuard({
  when,
  isLeaveAllowed,
}: BankReconciliationLeaveGuardProps) {
  useEffect(() => {
    if (!when) return undefined;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (isLeaveAllowed()) return;
      event.preventDefault();
      // Chrome needs a value set to show its dialog.
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [when, isLeaveAllowed]);

  return (
    <Prompt
      when={when}
      message={() =>
        isLeaveAllowed() || intl.get('bank_reconciliation.leave_confirm')
      }
    />
  );
}
