import {
  Button,
  ButtonGroup,
  Checkbox,
  InputGroup,
  Switch,
} from '@blueprintjs/core';
import React, { useMemo } from 'react';
import intl from 'react-intl-universal';
import styled from 'styled-components';
import { useBankReconciliationContext } from './BankReconciliationProvider';
import { refKey } from './utils';
import type { BankReconciliationRow, BankReconciliationTab } from './utils';
import type { DataTableColumn } from '@/components/Datatable/types';
import { DataTable } from '@/components';
import { formattedAmount } from '@/utils';

const Toolbar = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 16px;
  padding: 8px 15px;

  .bp4-switch {
    margin-bottom: 0;
  }
`;

const TableBox = styled.div`
  margin: 0 15px 90px;
`;

/**
 * Tabs, the after-statement-date switch and the text search.
 */
function BankReconciliationToolbar() {
  const { filters, setFilters, isCreditCard } = useBankReconciliationContext();

  const tabs: { id: BankReconciliationTab; label: string }[] = [
    {
      id: 'payments',
      label: intl.get('bank_reconciliation.payments'),
    },
    {
      id: 'deposits',
      label: intl.get(
        isCreditCard
          ? 'bank_reconciliation.charges'
          : 'bank_reconciliation.deposits',
      ),
    },
    { id: 'all', label: intl.get('bank_reconciliation.all') },
  ];

  return (
    <Toolbar>
      <ButtonGroup>
        {tabs.map((tab) => (
          <Button
            key={tab.id}
            active={filters.tab === tab.id}
            data-testid={`reconcile-tab-${tab.id}`}
            onClick={() => setFilters({ tab: tab.id })}
          >
            {tab.label}
          </Button>
        ))}
      </ButtonGroup>
      <Switch
        label={intl.get('bank_reconciliation.show_after_statement_date')}
        checked={filters.showAfterStatementDate}
        data-testid="reconcile-show-after-date"
        onChange={(e) =>
          setFilters({ showAfterStatementDate: e.currentTarget.checked })
        }
      />
      <InputGroup
        leftIcon="search"
        placeholder={intl.get('bank_reconciliation.search')}
        value={filters.search}
        data-testid="reconcile-search"
        onChange={(e) => setFilters({ search: e.currentTarget.value })}
      />
    </Toolbar>
  );
}

/**
 * Header checkbox: selects or clears the VISIBLE rows only.
 */
function SelectAllHeader() {
  const { visibleRows, selectedKeys, changeVisibleSelection } =
    useBankReconciliationContext();
  const visibleKeys = visibleRows.map(refKey);
  const selectedCount = visibleKeys.filter((k) => selectedKeys.has(k)).length;
  const all = visibleKeys.length > 0 && selectedCount === visibleKeys.length;

  return (
    <div>
      <Checkbox
        checked={all}
        indeterminate={selectedCount > 0 && !all}
        disabled={visibleKeys.length === 0}
        data-testid="reconcile-select-all"
        onChange={() => changeVisibleSelection(all ? [] : visibleKeys)}
      />
    </div>
  );
}

function SelectRowCell({ row }: { row: { original: BankReconciliationRow } }) {
  const { visibleRows, selectedKeys, changeVisibleSelection } =
    useBankReconciliationContext();
  const key = refKey(row.original);

  const handleChange = () =>
    changeVisibleSelection(
      visibleRows
        .map(refKey)
        .filter((k) =>
          k === key ? !selectedKeys.has(k) : selectedKeys.has(k),
        ),
    );

  return (
    <div className="selection-checkbox">
      <Checkbox
        checked={selectedKeys.has(key)}
        data-testid={`reconcile-check-${key}`}
        onChange={handleChange}
      />
    </div>
  );
}
SelectRowCell.cellType = 'field';

const compareAmount = (
  a: { original: BankReconciliationRow },
  b: { original: BankReconciliationRow },
) => a.original.amount - b.original.amount;

function useColumns(): DataTableColumn<BankReconciliationRow>[] {
  const { isCreditCard, currencyCode } = useBankReconciliationContext();

  return useMemo(() => {
    // Payments hold the negative amounts, deposits (charges) the positive.
    const side = (row: BankReconciliationRow, positive: boolean) => {
      const isPositive = row.amount > 0;
      if (row.amount === 0 || isPositive !== positive) return '';
      return formattedAmount(Math.abs(row.amount), currencyCode);
    };

    return [
      {
        id: 'date',
        Header: intl.get('date'),
        accessor: 'date',
        Cell: ({ row }) => row.original.formattedDate,
        width: 110,
      },
      {
        id: 'type',
        Header: intl.get('type'),
        accessor: (r) => r.transactionType ?? '',
        width: 140,
        textOverview: true,
      },
      {
        id: 'number',
        Header: intl.get('bank_reconciliation.number'),
        accessor: (r) => r.transactionNumber ?? '',
        width: 130,
        textOverview: true,
      },
      {
        id: 'reference',
        Header: intl.get('reference'),
        accessor: (r) => r.referenceNumber ?? '',
        width: 130,
        textOverview: true,
      },
      {
        id: 'contact',
        Header: intl.get('contact_name'),
        accessor: (r) => r.contactName ?? '',
        width: 160,
        textOverview: true,
      },
      {
        id: 'description',
        Header: intl.get('description'),
        accessor: (r) => r.description ?? '',
        width: 200,
        textOverview: true,
      },
      {
        id: 'payment',
        Header: intl.get('bank_reconciliation.payments'),
        accessor: (r) => side(r, false),
        sortType: compareAmount,
        width: 120,
        align: 'right',
        money: true,
      },
      {
        id: 'deposit',
        Header: intl.get(
          isCreditCard
            ? 'bank_reconciliation.charges'
            : 'bank_reconciliation.deposits',
        ),
        accessor: (r) => side(r, true),
        sortType: compareAmount,
        width: 120,
        align: 'right',
        money: true,
      },
    ] as DataTableColumn<BankReconciliationRow>[];
  }, [isCreditCard, currencyCode]);
}

/**
 * The transactions table. The selection is controlled by the provider (a set
 * of keys), through custom selection cells, so it never depends on which rows
 * react-table currently renders.
 */
export function BankReconciliationTable() {
  const { visibleRows } = useBankReconciliationContext();
  const columns = useColumns();

  return (
    <>
      <BankReconciliationToolbar />
      <TableBox>
        <DataTable
          columns={columns}
          data={visibleRows}
          sticky={true}
          selectionColumn={{
            Header: SelectAllHeader,
            Cell: SelectRowCell,
          }}
          selectionColumnWidth={45}
          getRowId={(row: BankReconciliationRow) => refKey(row)}
          rowTestId={(row: { id: string }) => `reconcile-row-${row.id}`}
          autoResetSortBy={false}
          noResults={intl.get('no_results')}
        />
      </TableBox>
    </>
  );
}
