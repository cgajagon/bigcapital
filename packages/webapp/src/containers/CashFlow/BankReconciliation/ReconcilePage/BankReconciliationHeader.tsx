import { Button, Classes } from '@blueprintjs/core';
import * as FF from 'fp-ts/function';
import React from 'react';
import intl from 'react-intl-universal';
import styled from 'styled-components';
import { formatSignedAmount, useBankReconciliationDateFormat } from '../format';
import { useBankReconciliationContext } from './BankReconciliationProvider';
import type { WithDialogActionsProps } from '@/containers/Dialog/withDialogActions';
import { DialogsName } from '@/constants/dialogs';
import { withDialogActions } from '@/containers/Dialog/withDialogActions';

const Bar = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 32px;
  padding: 16px 15px 8px;
`;

const Figure = styled.div<{ $danger?: boolean }>`
  .label {
    font-size: 12px;
    opacity: 0.7;
  }
  .value {
    font-size: 22px;
    font-weight: 600;
    color: ${(props) =>
      props.$danger ? 'var(--color-danger, #cd4246)' : 'inherit'};
  }
`;

function BankReconciliationHeaderRoot({
  // #withDialogActions
  openDialog,
}: Pick<WithDialogActionsProps, 'openDialog'>) {
  const {
    header,
    currencyCode,
    statementDate,
    endingBalance,
    beginningBalance,
  } = useBankReconciliationContext();
  const formatDate = useBankReconciliationDateFormat();
  const fmt = (amount: number) => formatSignedAmount(amount, currencyCode);

  return (
    <Bar>
      <Figure>
        <div className="label">
          {intl.get('bank_reconciliation.beginning_balance')}
        </div>
        <div className="value" data-testid="reconcile-beginning-balance">
          {fmt(beginningBalance)}
        </div>
      </Figure>
      <Figure>
        <div className="label">
          {intl.get('bank_reconciliation.statement_ending_balance')}
        </div>
        <div className="value" data-testid="reconcile-ending-balance">
          {fmt(endingBalance)}
        </div>
      </Figure>
      <Figure>
        <div className="label">
          {intl.get('bank_reconciliation.cleared_balance')}
        </div>
        <div className="value" data-testid="reconcile-cleared-balance">
          {fmt(header.clearedBalance)}
        </div>
      </Figure>
      <Figure $danger={header.difference !== 0}>
        <div className="label">
          {intl.get('bank_reconciliation.difference')}
        </div>
        <div className="value" data-testid="reconcile-difference">
          {fmt(header.difference)}
        </div>
      </Figure>
      <Figure>
        <div className="label">
          {intl.get('bank_reconciliation.statement_ending_date')}
        </div>
        <div className="value" data-testid="reconcile-statement-date">
          {formatDate(statementDate)}
        </div>
      </Figure>
      <Button
        minimal
        className={Classes.TEXT_MUTED}
        data-testid="reconcile-edit-info"
        onClick={() => openDialog(DialogsName.BankReconciliationEditInfo)}
      >
        {intl.get('bank_reconciliation.edit_info')}
      </Button>
    </Bar>
  );
}

export const BankReconciliationHeader = FF.pipe(
  BankReconciliationHeaderRoot,
  withDialogActions,
);
