import { Button, Callout, Classes, Intent, Spinner } from '@blueprintjs/core';
import React, { useState } from 'react';
import intl from 'react-intl-universal';
import styled from 'styled-components';
import { BankReconciliationDetail } from './BankReconciliationDetail';
import { DrawerBody, DrawerHeaderContent } from '@/components';
import { DRAWERS } from '@/constants/drawers';
import {
  formatSignedAmount,
  useBankReconciliationDateFormat,
} from '@/containers/CashFlow/BankReconciliation/format';
import { useAccount } from '@/hooks/query/accounts/queries';
import { useBankReconciliations } from '@/hooks/query/banking';

const Table = styled.table`
  width: 100%;
  border-collapse: collapse;

  th,
  td {
    text-align: left;
    padding: 8px 10px;
    border-bottom: 1px solid rgba(128, 128, 128, 0.25);
  }
  th.num,
  td.num {
    text-align: right;
  }
  tbody tr {
    cursor: pointer;
  }
  tbody tr:hover {
    background: rgba(128, 128, 128, 0.1);
  }
`;

interface BankReconciliationHistoryContentProps {
  accountId?: number;
}

/**
 * History drawer content: the list of completed reconciliations, or the
 * detail of the clicked one.
 */
export function BankReconciliationHistoryContent({
  accountId,
}: BankReconciliationHistoryContentProps) {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const formatDate = useBankReconciliationDateFormat();
  const { data: account } = useAccount(accountId);
  const {
    data: list,
    isLoading,
    isError,
  } = useBankReconciliations(accountId as number);
  const currencyCode = account?.currencyCode;

  // After an undo the selected one leaves the list: fall back to the list.
  const selectedIndex = list
    ? list.findIndex((item) => item.id === selectedId)
    : -1;

  let body: React.ReactNode;
  if (isLoading) {
    body = <Spinner size={30} />;
  } else if (isError || !list) {
    body = (
      <Callout intent={Intent.DANGER}>
        {intl.get('bank_reconciliation.history_load_failed')}
      </Callout>
    );
  } else if (selectedId !== null && selectedIndex >= 0) {
    body = (
      <BankReconciliationDetail
        reconciliationId={selectedId}
        // The list is sorted by statement date, newest first: this one and
        // every later one are the entries up to its index.
        count={selectedIndex + 1}
        remaining={list.length - (selectedIndex + 1)}
        currencyCode={currencyCode}
        onBack={() => setSelectedId(null)}
      />
    );
  } else if (list.length === 0) {
    body = (
      <p className={Classes.TEXT_MUTED}>
        {intl.get('bank_reconciliation.history_empty')}
      </p>
    );
  } else {
    body = (
      <Table>
        <thead>
          <tr>
            <th>{intl.get('bank_reconciliation.statement_ending_date')}</th>
            <th className="num">
              {intl.get('bank_reconciliation.statement_ending_balance')}
            </th>
            <th>{intl.get('bank_reconciliation.completed_by')}</th>
            <th>{intl.get('bank_reconciliation.completed_on')}</th>
          </tr>
        </thead>
        <tbody>
          {list.map((item) => (
            <tr key={item.id} onClick={() => setSelectedId(item.id)}>
              <td>
                <Button minimal small intent={Intent.PRIMARY}>
                  {formatDate(item.statementDate)}
                </Button>
              </td>
              <td className="num">
                {formatSignedAmount(item.endingBalance, currencyCode)}
              </td>
              <td>{item.completedByName ?? '—'}</td>
              <td>{formatDate(item.completedAt)}</td>
            </tr>
          ))}
        </tbody>
      </Table>
    );
  }

  return (
    <>
      <DrawerHeaderContent
        name={DRAWERS.BANK_RECONCILIATION_HISTORY}
        title={intl.get('bank_reconciliation.history')}
      />
      <DrawerBody>
        <div style={{ padding: 15 }}>{body}</div>
      </DrawerBody>
    </>
  );
}
