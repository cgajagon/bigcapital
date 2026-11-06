import {
  Button,
  Callout,
  Classes,
  Intent,
  Spinner,
  Tag,
} from '@blueprintjs/core';
import React from 'react';
import intl from 'react-intl-universal';
import styled from 'styled-components';
import { formatHistoryDate } from './formatHistoryDate';
import { Can } from '@/components';
import { AbilitySubject, CashflowAction } from '@/constants/abilityOption';
import { DRAWERS } from '@/constants/drawers';
import { roundAmount } from '@/containers/CashFlow/BankReconciliation/ReconcilePage/utils';
import { handleViewTransactionDetail } from '@/containers/FinancialStatements/utils/transactionDrawer';
import { useBankReconciliation } from '@/hooks/query/banking';
import { useAlertActions, useDrawerActions } from '@/hooks/state';
import { formattedAmount } from '@/utils';

const Totals = styled.dl`
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 4px 24px;
  max-width: 420px;
  margin: 12px 0 20px;

  dd {
    margin: 0;
    text-align: right;
    font-weight: 600;
  }
  dt {
    margin: 0;
  }
`;

const Table = styled.table`
  width: 100%;
  border-collapse: collapse;

  th,
  td {
    text-align: left;
    padding: 6px 8px;
    border-bottom: 1px solid rgba(128, 128, 128, 0.25);
  }
  th.num,
  td.num {
    text-align: right;
  }
`;

interface BankReconciliationDetailProps {
  reconciliationId: number;
  // Reconciliations dated on or after this one (it included).
  count: number;
  // Reconciliations that stay after the undo.
  remaining: number;
  currencyCode?: string;
  onBack: () => void;
}

/**
 * Detail of one completed reconciliation: totals, then its transactions.
 */
export function BankReconciliationDetail({
  reconciliationId,
  count,
  remaining,
  currencyCode,
  onBack,
}: BankReconciliationDetailProps) {
  const { data, isLoading } = useBankReconciliation(reconciliationId);
  const { openDrawer } = useDrawerActions();
  const { openAlert } = useAlertActions();
  const fmt = (amount?: number | null) =>
    amount == null ? '—' : formattedAmount(amount, currencyCode);

  const handleUndo = () => {
    openAlert('bank-reconciliation-undo', {
      reconciliationId,
      count,
      remaining,
    });
  };

  let content: React.ReactNode;
  if (isLoading) {
    content = <Spinner size={30} />;
  } else if (!data) {
    // Stale `data` with `isError` (e.g. a 404 right after an undo) still renders
    // the content; the list unmounts this view a moment later.
    content = (
      <Callout intent={Intent.DANGER}>
        {intl.get('bank_reconciliation.history_load_failed')}
      </Callout>
    );
  } else {
    content = (
      <>
        <div className={Classes.TEXT_MUTED} style={{ marginTop: 8 }}>
          {intl.get('bank_reconciliation.completed_on')}:{' '}
          {formatHistoryDate(data.completedAt)}
          {' · '}
          {intl.get('bank_reconciliation.completed_by')}:{' '}
          {data.completedByName ?? '—'}
        </div>
        <Totals>
          <dt>{intl.get('bank_reconciliation.beginning_balance')}</dt>
          <dd>{fmt(data.beginningBalance)}</dd>
          <dt>{intl.get('bank_reconciliation.cleared_increases')}</dt>
          <dd>{fmt(data.clearedIncreases)}</dd>
          <dt>{intl.get('bank_reconciliation.cleared_decreases')}</dt>
          <dd>{fmt(data.clearedDecreases)}</dd>
          <dt>{intl.get('bank_reconciliation.statement_ending_balance')}</dt>
          <dd>{fmt(data.endingBalance)}</dd>
          <dt>{intl.get('bank_reconciliation.book_balance')}</dt>
          <dd>{fmt(data.bookBalance)}</dd>
          <dt>
            {intl.get('bank_reconciliation.uncleared_total', {
              count: data.unclearedCount ?? 0,
            })}
          </dt>
          <dd>{fmt(data.unclearedTotal)}</dd>
        </Totals>

        <Table>
          <thead>
            <tr>
              <th>{intl.get('bank_reconciliation.date')}</th>
              <th>{intl.get('bank_reconciliation.transaction')}</th>
              <th className="num">
                {intl.get('bank_reconciliation.reconciled_amount')}
              </th>
              <th className="num">
                {intl.get('bank_reconciliation.current_amount')}
              </th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data.transactions.map((tx) => {
              const label =
                [tx.transactionType, tx.transactionNumber]
                  .filter(Boolean)
                  .join(' ') || tx.referenceType;
              const changed =
                !tx.isDeleted &&
                roundAmount(Number(tx.currentAmount)) !==
                  roundAmount(Number(tx.amount));
              return (
                <tr key={`${tx.referenceType}-${tx.referenceId}`}>
                  <td>{formatHistoryDate(tx.date)}</td>
                  <td>
                    {tx.isDeleted ? (
                      label
                    ) : (
                      <Button
                        minimal
                        small
                        intent={Intent.PRIMARY}
                        onClick={() =>
                          handleViewTransactionDetail(
                            {
                              referenceType: tx.referenceType,
                              referenceId: tx.referenceId,
                            },
                            openDrawer,
                            DRAWERS.CASHFLOW_TRNASACTION_DETAILS,
                          )
                        }
                      >
                        {label}
                      </Button>
                    )}
                    {tx.contactName ? ` · ${tx.contactName}` : ''}
                  </td>
                  <td className="num">{fmt(tx.amount)}</td>
                  <td className="num">
                    {tx.isDeleted ? '—' : fmt(tx.currentAmount)}
                  </td>
                  <td>
                    {tx.isDeleted && (
                      <Tag minimal intent={Intent.DANGER}>
                        {intl.get('bank_reconciliation.deleted')}
                      </Tag>
                    )}
                    {changed && (
                      <Tag minimal intent={Intent.WARNING}>
                        {intl.get('bank_reconciliation.changed')}
                      </Tag>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      </>
    );
  }

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
        <Button icon="arrow-left" minimal onClick={onBack}>
          {intl.get('bank_reconciliation.back')}
        </Button>
        <Can I={CashflowAction.UndoReconciliation} a={AbilitySubject.Cashflow}>
          <Button intent={Intent.DANGER} onClick={handleUndo}>
            {intl.get('bank_reconciliation.undo')}
          </Button>
        </Can>
      </div>
      {content}
    </>
  );
}
