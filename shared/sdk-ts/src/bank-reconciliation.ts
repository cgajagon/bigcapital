import type { ApiFetcher } from './fetch-utils';
import { paths } from './schema';
import { OpForPath, OpQueryParams, OpRequestBody, OpResponseBody } from './utils';

export const BANK_RECONCILIATION_ROUTES = {
  SUMMARY: '/api/banking/reconciliations/accounts/{accountId}/summary',
  TRANSACTIONS: '/api/banking/reconciliations/accounts/{accountId}/transactions',
  LIST: '/api/banking/reconciliations',
  DETAIL: '/api/banking/reconciliations/{id}',
  DRAFT: '/api/banking/reconciliations/accounts/{accountId}/draft',
  FINISH: '/api/banking/reconciliations/accounts/{accountId}/finish',
  UNDO: '/api/banking/reconciliations/{id}/undo',
} as const satisfies Record<string, keyof paths>;

export type BankReconciliationSummaryResponse = OpResponseBody<OpForPath<typeof BANK_RECONCILIATION_ROUTES.SUMMARY, 'get'>>;
export type BankReconciliationSummaryQuery = OpQueryParams<OpForPath<typeof BANK_RECONCILIATION_ROUTES.SUMMARY, 'get'>>;
export type BankReconciliationTransactionsResponse = OpResponseBody<OpForPath<typeof BANK_RECONCILIATION_ROUTES.TRANSACTIONS, 'get'>>;
export type BankReconciliationTransactionsQuery = OpQueryParams<OpForPath<typeof BANK_RECONCILIATION_ROUTES.TRANSACTIONS, 'get'>>;
export type BankReconciliationsListResponse = OpResponseBody<OpForPath<typeof BANK_RECONCILIATION_ROUTES.LIST, 'get'>>;
export type BankReconciliationDetailResponse = OpResponseBody<OpForPath<typeof BANK_RECONCILIATION_ROUTES.DETAIL, 'get'>>;
export type BankReconciliationInputBody = OpRequestBody<OpForPath<typeof BANK_RECONCILIATION_ROUTES.DRAFT, 'put'>>;
export type SaveBankReconciliationDraftResponse = OpResponseBody<OpForPath<typeof BANK_RECONCILIATION_ROUTES.DRAFT, 'put'>>;
export type FinishBankReconciliationResponse = OpResponseBody<OpForPath<typeof BANK_RECONCILIATION_ROUTES.FINISH, 'post'>>;

export async function fetchBankReconciliationSummary(
  fetcher: ApiFetcher,
  accountId: number,
  statementDate?: string
): Promise<BankReconciliationSummaryResponse> {
  const get = fetcher.path(BANK_RECONCILIATION_ROUTES.SUMMARY).method('get').create();
  const { data } = await get({ accountId, statementDate } as never);
  return data as BankReconciliationSummaryResponse;
}

export async function fetchBankReconciliationTransactions(
  fetcher: ApiFetcher,
  accountId: number,
  statementDate: string
): Promise<BankReconciliationTransactionsResponse> {
  const get = fetcher.path(BANK_RECONCILIATION_ROUTES.TRANSACTIONS).method('get').create();
  const { data } = await get({ accountId, statementDate } as never);
  return data as BankReconciliationTransactionsResponse;
}

export async function fetchBankReconciliations(
  fetcher: ApiFetcher,
  accountId: number
): Promise<BankReconciliationsListResponse> {
  const get = fetcher.path(BANK_RECONCILIATION_ROUTES.LIST).method('get').create();
  const { data } = await get({ accountId } as never);
  return data as BankReconciliationsListResponse;
}

export async function fetchBankReconciliation(
  fetcher: ApiFetcher,
  id: number
): Promise<BankReconciliationDetailResponse> {
  const get = fetcher.path(BANK_RECONCILIATION_ROUTES.DETAIL).method('get').create();
  const { data } = await get({ id });
  return data as BankReconciliationDetailResponse;
}

export async function saveBankReconciliationDraft(
  fetcher: ApiFetcher,
  accountId: number,
  body: BankReconciliationInputBody
): Promise<SaveBankReconciliationDraftResponse> {
  const put = fetcher.path(BANK_RECONCILIATION_ROUTES.DRAFT).method('put').create();
  const { data } = await put({ accountId, ...body } as never);
  return data as SaveBankReconciliationDraftResponse;
}

export async function discardBankReconciliationDraft(
  fetcher: ApiFetcher,
  accountId: number
): Promise<void> {
  const del = fetcher.path(BANK_RECONCILIATION_ROUTES.DRAFT).method('delete').create();
  await del({ accountId });
}

export async function finishBankReconciliation(
  fetcher: ApiFetcher,
  accountId: number,
  body: BankReconciliationInputBody
): Promise<FinishBankReconciliationResponse> {
  const post = fetcher.path(BANK_RECONCILIATION_ROUTES.FINISH).method('post').create();
  const { data } = await post({ accountId, ...body } as never);
  return data as FinishBankReconciliationResponse;
}

export async function undoBankReconciliation(fetcher: ApiFetcher, id: number): Promise<void> {
  const post = fetcher.path(BANK_RECONCILIATION_ROUTES.UNDO).method('post').create();
  await post({ id });
}
