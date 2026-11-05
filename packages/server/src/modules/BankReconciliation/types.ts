export type AccountNormal = 'debit' | 'credit';

export type ReconcileStatus = 'reconciled' | 'cleared' | 'none';

export enum BankReconciliationStatus {
  Draft = 'draft',
  Completed = 'completed',
}

export const RECONCILABLE_ACCOUNT_TYPES = ['bank', 'cash', 'credit-card'];

export interface ReconcileRef {
  referenceType: string;
  referenceId: number;
}

export interface LedgerLine {
  debit: number;
  credit: number;
  basis: 'cash' | 'accrual' | null;
}

export interface ReconciledSnapshot extends ReconcileRef {
  reconciliationId: number;
  amount: number;
  date: string;
  transactionTypeKey: string | null;
  transactionNumber: string | null;
  referenceNumber: string | null;
  contactName: string | null;
}

export interface ChangedReconciledItem extends ReconciledSnapshot {
  currentAmount: number;
  isDeleted: boolean;
}

export interface FinishCheckInput {
  accountType: string;
  accountCurrency: string;
  baseCurrency: string;
  statementDate: string;
  lastStatementDate: string | null;
  beginningBalance: number;
  endingBalance: number;
  selected: ReconcileRef[];
  eligibleAmounts: Map<string, number>;
  reconciledKeys: Set<string>;
}

export const ERRORS = {
  ACCOUNT_NOT_RECONCILABLE: 'BANK_RECONCILIATION_ACCOUNT_NOT_RECONCILABLE',
  FOREIGN_CURRENCY: 'BANK_RECONCILIATION_FOREIGN_CURRENCY',
  STATEMENT_DATE_NOT_AFTER_LAST:
    'BANK_RECONCILIATION_STATEMENT_DATE_NOT_AFTER_LAST',
  TRANSACTION_NOT_ON_ACCOUNT: 'BANK_RECONCILIATION_TRANSACTION_NOT_ON_ACCOUNT',
  TRANSACTION_ALREADY_RECONCILED:
    'BANK_RECONCILIATION_TRANSACTION_ALREADY_RECONCILED',
  DIFFERENCE_NOT_ZERO: 'BANK_RECONCILIATION_DIFFERENCE_NOT_ZERO',
  NOT_FOUND: 'BANK_RECONCILIATION_NOT_FOUND',
};
