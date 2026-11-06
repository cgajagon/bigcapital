import {
  discardBankReconciliationDraft,
  fetchBankReconciliation,
  fetchBankReconciliations,
  fetchBankReconciliationSummary,
  fetchBankReconciliationTransactions,
  finishBankReconciliation,
  saveBankReconciliationDraft,
  undoBankReconciliation,
} from '@bigcapital/sdk-ts';
import {
  QueryClient,
  UseMutationOptions,
  UseMutationResult,
  UseQueryOptions,
  UseQueryResult,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useApiFetcher } from '../../../useRequest';
import { accountsKeys } from '../../accounts/query-keys';
import { CASHFLOW_ACCOUNT_TRANSACTIONS_INFINITY } from '../../cashflow-accounts/query-keys';
import {
  BANK_RECONCILIATIONS,
  BANK_RECONCILIATION_SUMMARY,
  BANK_RECONCILIATION_TRANSACTIONS,
  bankingKeys,
} from '../query-keys';
import type {
  BankReconciliationDetailResponse,
  BankReconciliationInputBody,
  BankReconciliationsListResponse,
  BankReconciliationSummaryResponse,
  BankReconciliationTransactionsResponse,
  FinishBankReconciliationResponse,
  SaveBankReconciliationDraftResponse,
  UndoBankReconciliationResponse,
} from '@bigcapital/sdk-ts';

/** Variables of the save-draft and finish mutations. */
export interface BankReconciliationSaveValues {
  accountId: number;
  body: BankReconciliationInputBody;
}

/** Invalidates everything a reconciliation change can make stale. */
const invalidateBankReconciliationQueries = (queryClient: QueryClient) => {
  queryClient.invalidateQueries({ queryKey: [BANK_RECONCILIATION_SUMMARY] });
  queryClient.invalidateQueries({
    queryKey: [BANK_RECONCILIATION_TRANSACTIONS],
  });
  queryClient.invalidateQueries({ queryKey: [BANK_RECONCILIATIONS] });
  // Bare prefix on purpose: the `transactionsInfinity()` factory puts
  // `undefined` in the account and query slots, which never match a cached key.
  queryClient.invalidateQueries({
    queryKey: [CASHFLOW_ACCOUNT_TRANSACTIONS_INFINITY],
  });
  queryClient.invalidateQueries({ queryKey: accountsKeys.all() });
};

export function useBankReconciliationSummary(
  accountId: number,
  statementDate?: string,
  options?: UseQueryOptions<BankReconciliationSummaryResponse, Error>,
): UseQueryResult<BankReconciliationSummaryResponse, Error> {
  const fetcher = useApiFetcher({ enableCamelCaseTransform: true });
  return useQuery({
    ...options,
    enabled: !!accountId && (options?.enabled ?? true),
    queryKey: bankingKeys.reconciliationSummary(accountId, statementDate),
    queryFn: () =>
      fetchBankReconciliationSummary(fetcher, accountId, statementDate),
  });
}

export function useBankReconciliationTransactions(
  accountId: number,
  statementDate: string,
  options?: UseQueryOptions<BankReconciliationTransactionsResponse, Error>,
): UseQueryResult<BankReconciliationTransactionsResponse, Error> {
  const fetcher = useApiFetcher({ enableCamelCaseTransform: true });
  return useQuery({
    ...options,
    enabled: !!accountId && !!statementDate && (options?.enabled ?? true),
    queryKey: bankingKeys.reconciliationTransactions(accountId, statementDate),
    queryFn: () =>
      fetchBankReconciliationTransactions(fetcher, accountId, statementDate),
  });
}

export function useBankReconciliations(
  accountId: number,
  options?: UseQueryOptions<BankReconciliationsListResponse, Error>,
): UseQueryResult<BankReconciliationsListResponse, Error> {
  const fetcher = useApiFetcher({ enableCamelCaseTransform: true });
  return useQuery({
    ...options,
    enabled: !!accountId && (options?.enabled ?? true),
    queryKey: bankingKeys.reconciliations(accountId),
    queryFn: () => fetchBankReconciliations(fetcher, accountId),
  });
}

export function useBankReconciliation(
  id: number,
  options?: UseQueryOptions<BankReconciliationDetailResponse, Error>,
): UseQueryResult<BankReconciliationDetailResponse, Error> {
  const fetcher = useApiFetcher({ enableCamelCaseTransform: true });
  return useQuery({
    ...options,
    enabled: !!id && (options?.enabled ?? true),
    queryKey: bankingKeys.reconciliation(id),
    queryFn: () => fetchBankReconciliation(fetcher, id),
  });
}

export function useSaveBankReconciliationDraft(
  options?: UseMutationOptions<
    SaveBankReconciliationDraftResponse,
    Error,
    BankReconciliationSaveValues
  >,
): UseMutationResult<
  SaveBankReconciliationDraftResponse,
  Error,
  BankReconciliationSaveValues
> {
  const queryClient = useQueryClient();
  const fetcher = useApiFetcher({ enableCamelCaseTransform: true });
  return useMutation({
    mutationFn: ({ accountId, body }: BankReconciliationSaveValues) =>
      saveBankReconciliationDraft(fetcher, accountId, body),
    ...options,
    onSuccess: (...args) => {
      invalidateBankReconciliationQueries(queryClient);
      return options?.onSuccess?.(...args);
    },
  });
}

export function useDiscardBankReconciliationDraft(
  options?: UseMutationOptions<void, Error, number>,
): UseMutationResult<void, Error, number> {
  const queryClient = useQueryClient();
  const fetcher = useApiFetcher({ enableCamelCaseTransform: true });
  return useMutation({
    mutationFn: (accountId: number) =>
      discardBankReconciliationDraft(fetcher, accountId),
    ...options,
    onSuccess: (...args) => {
      invalidateBankReconciliationQueries(queryClient);
      return options?.onSuccess?.(...args);
    },
  });
}

export function useFinishBankReconciliation(
  options?: UseMutationOptions<
    FinishBankReconciliationResponse,
    Error,
    BankReconciliationSaveValues
  >,
): UseMutationResult<
  FinishBankReconciliationResponse,
  Error,
  BankReconciliationSaveValues
> {
  const queryClient = useQueryClient();
  const fetcher = useApiFetcher({ enableCamelCaseTransform: true });
  return useMutation({
    mutationFn: ({ accountId, body }: BankReconciliationSaveValues) =>
      finishBankReconciliation(fetcher, accountId, body),
    ...options,
    onSuccess: (...args) => {
      invalidateBankReconciliationQueries(queryClient);
      return options?.onSuccess?.(...args);
    },
  });
}

export function useUndoBankReconciliation(
  options?: UseMutationOptions<UndoBankReconciliationResponse, Error, number>,
): UseMutationResult<UndoBankReconciliationResponse, Error, number> {
  const queryClient = useQueryClient();
  const fetcher = useApiFetcher({ enableCamelCaseTransform: true });
  return useMutation({
    mutationFn: (id: number) => undoBankReconciliation(fetcher, id),
    ...options,
    onSuccess: (...args) => {
      invalidateBankReconciliationQueries(queryClient);
      return options?.onSuccess?.(...args);
    },
  });
}
