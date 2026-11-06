import { keepPreviousData } from '@tanstack/react-query';
import moment from 'moment';
import React, {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useHistory, useLocation, useParams } from 'react-router-dom';
import {
  computeHeader,
  filterRows,
  mergeSelection,
  hasTooManyDecimals,
  refKey,
  stateSignature,
} from './utils';
import type { BankReconciliationFilters, BankReconciliationRow } from './utils';
import type {
  Account,
  BankReconciliationSummaryResponse,
} from '@bigcapital/sdk-ts';
import { DashboardInsider } from '@/components';
import { useAccount } from '@/hooks/query';
import {
  useBankReconciliationSummary,
  useBankReconciliationTransactions,
} from '@/hooks/query/banking';

interface StatementInfo {
  statementDate: string;
  endingBalance: number;
}

export interface BankReconciliationContextValue {
  accountId: number;
  account?: Account;
  isCreditCard: boolean;
  currencyCode?: string;
  // Summary for the statement date once loaded, else the plain one.
  summary?: BankReconciliationSummaryResponse;
  // Summary queried WITH the statement date: feeds the notices.
  datedSummary?: BankReconciliationSummaryResponse;
  lastStatementDate?: string | null;
  beginningBalance: number;

  statementDate: string;
  endingBalance: number;
  setStatementInfo: (info: StatementInfo) => void;

  rows: BankReconciliationRow[];
  visibleRows: BankReconciliationRow[];
  droppedCount: number;
  isTransactionsFetching: boolean;
  isTransactionsError: boolean;

  selectedKeys: Set<string>;
  // Merges a change made on the visible rows (see `mergeSelection`).
  changeVisibleSelection: (selectedVisibleKeys: string[]) => void;

  filters: BankReconciliationFilters;
  setFilters: (patch: Partial<BankReconciliationFilters>) => void;

  header: ReturnType<typeof computeHeader>;
  isDirty: boolean;
  // The current state was saved: it is no longer "unsaved".
  markSaved: () => void;
}

const BankReconciliationContext =
  React.createContext<BankReconciliationContextValue>(
    {} as BankReconciliationContextValue,
  );

export const useBankReconciliationContext = () =>
  useContext(BankReconciliationContext);

const isValidDate = (value: string | null): value is string =>
  !!value && moment(value, 'YYYY-MM-DD', true).isValid();

/**
 * Reads the start params. `null` when none were given (resume), 'invalid'
 * when they are given but unusable.
 */
function parseStartParams(search: string): StatementInfo | null | 'invalid' {
  const params = new URLSearchParams(search);
  const date = params.get('statementDate');
  const balance = params.get('endingBalance');
  if (date === null && balance === null) return null;
  const endingBalance = Number(balance);
  if (
    !isValidDate(date) ||
    balance === null ||
    balance.trim() === '' ||
    !Number.isFinite(endingBalance) ||
    hasTooManyDecimals(balance)
  ) {
    return 'invalid';
  }
  return { statementDate: date, endingBalance };
}

/**
 * Reconcile page state: account, summary, transactions, ticks and header.
 */
export function BankReconciliationProvider({
  children,
}: {
  children?: React.ReactNode;
}) {
  const { id } = useParams<{ id: string }>();
  const accountId = parseInt(id ?? '', 10);
  const history = useHistory();
  const { search } = useLocation();

  const goToAccount = useCallback(
    () => history.replace(`/cashflow-accounts/${accountId}/transactions`),
    [history, accountId],
  );

  const { data: account } = useAccount(accountId);
  const { data: baseSummary, isError: isSummaryError } =
    useBankReconciliationSummary(accountId);

  // Statement info: from the URL, else from the draft. Resolved once.
  const startParams = useMemo(() => parseStartParams(search), [search]);
  const [info, setInfo] = useState<StatementInfo | null>(() =>
    startParams && startParams !== 'invalid' ? startParams : null,
  );
  const infoResolved = useRef(!!info);

  useEffect(() => {
    if (infoResolved.current) return;
    if (startParams === null && baseSummary) {
      if (baseSummary.draft) {
        infoResolved.current = true;
        setInfo({
          statementDate: baseSummary.draft.statementDate,
          endingBalance: Number(baseSummary.draft.endingBalance),
        });
      } else {
        goToAccount();
      }
    }
  }, [startParams, baseSummary, goToAccount]);

  // Invalid params or a failed summary: leave once.
  useEffect(() => {
    if (startParams === 'invalid' || isSummaryError) goToAccount();
  }, [startParams, isSummaryError, goToAccount]);

  const statementDate = info?.statementDate ?? '';
  const endingBalance = info?.endingBalance ?? 0;

  const { data: datedSummary } = useBankReconciliationSummary(
    accountId,
    statementDate || undefined,
    // Keep the notices up while a new statement date loads.
    { placeholderData: keepPreviousData },
  );
  const summary = datedSummary ?? baseSummary;

  const {
    data: transactions,
    isFetching: isTransactionsFetching,
    isError: isTransactionsError,
    isPlaceholderData,
    isFetchedAfterMount,
  } = useBankReconciliationTransactions(accountId, statementDate, {
    placeholderData: keepPreviousData,
    // Always read fresh data on mount: a cached response must not seed the
    // ticks and hide another session's changes to the draft.
    staleTime: 0,
    refetchOnMount: 'always',
  });
  const rows = useMemo(
    () => (transactions?.transactions ?? []) as BankReconciliationRow[],
    [transactions],
  );

  // Ticks. Initialised ONCE from the first response's `selected`. Later
  // responses (a new statement date, a refetch) only drop ticks of rows that
  // no longer exist; they never reset the user's choices.
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [baseline, setBaseline] = useState<string | null>(null);
  const selectionInitialised = useRef(false);

  useEffect(() => {
    if (!transactions || isPlaceholderData || !info) return;
    if (!selectionInitialised.current) {
      if (!isFetchedAfterMount) return;
      selectionInitialised.current = true;
      const initial = new Set(transactions.selected.map(refKey));
      setSelectedKeys(initial);
      setBaseline(
        stateSignature(info.statementDate, info.endingBalance, initial),
      );
      return;
    }
    const existing = new Set(rows.map(refKey));
    setSelectedKeys((previous) => {
      const kept = [...previous].filter((key) => existing.has(key));
      return kept.length === previous.size ? previous : new Set(kept);
    });
  }, [transactions, isPlaceholderData, isFetchedAfterMount, rows, info]);

  const [filters, setFiltersState] = useState<BankReconciliationFilters>({
    tab: 'all',
    showAfterStatementDate: false,
    search: '',
  });
  const setFilters = useCallback(
    (patch: Partial<BankReconciliationFilters>) =>
      setFiltersState((previous) => ({ ...previous, ...patch })),
    [],
  );
  const visibleRows = useMemo(() => filterRows(rows, filters), [rows, filters]);

  const changeVisibleSelection = useCallback(
    (selectedVisibleKeys: string[]) =>
      setSelectedKeys((previous) =>
        mergeSelection(previous, visibleRows.map(refKey), selectedVisibleKeys),
      ),
    [visibleRows],
  );

  const beginningBalance = Number(summary?.beginningBalance ?? 0);
  const header = useMemo(
    () => computeHeader(beginningBalance, rows, selectedKeys, endingBalance),
    [beginningBalance, rows, selectedKeys, endingBalance],
  );

  const signature = stateSignature(statementDate, endingBalance, selectedKeys);
  const isDirty = baseline !== null && signature !== baseline;
  const markSaved = useCallback(() => setBaseline(signature), [signature]);

  const accountType = summary?.account?.accountType ?? account?.accountType;

  const value = useMemo<BankReconciliationContextValue>(
    () => ({
      accountId,
      account,
      isCreditCard: accountType === 'credit-card',
      currencyCode: summary?.account?.currencyCode ?? account?.currencyCode,
      summary,
      datedSummary,
      lastStatementDate: summary?.lastReconciliation?.statementDate,
      beginningBalance,
      statementDate,
      endingBalance,
      setStatementInfo: setInfo,
      rows,
      visibleRows,
      droppedCount: transactions?.droppedFromDraftCount ?? 0,
      isTransactionsFetching,
      isTransactionsError,
      selectedKeys,
      changeVisibleSelection,
      filters,
      setFilters,
      header,
      isDirty,
      markSaved,
    }),
    [
      accountId,
      account,
      accountType,
      summary,
      datedSummary,
      beginningBalance,
      statementDate,
      endingBalance,
      rows,
      visibleRows,
      transactions,
      isTransactionsFetching,
      isTransactionsError,
      selectedKeys,
      changeVisibleSelection,
      filters,
      setFilters,
      header,
      isDirty,
      markSaved,
    ],
  );

  return (
    <DashboardInsider
      name={'bank-reconciliation'}
      loading={!info || !summary || !transactions}
    >
      <BankReconciliationContext.Provider value={value}>
        {children}
      </BankReconciliationContext.Provider>
    </DashboardInsider>
  );
}
