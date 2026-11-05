import {
  AccountNormal,
  ChangedReconciledItem,
  ERRORS,
  FinishCheckInput,
  LedgerLine,
  RECONCILABLE_ACCOUNT_TYPES,
  ReconciledSnapshot,
  ReconcileRef,
  ReconcileStatus,
} from './types';

export const refKey = (ref: ReconcileRef): string =>
  `${ref.referenceType}-${ref.referenceId}`;

/**
 * Ledger rows store the source transaction type, which differs from the type
 * stored by bank matching for manual journals ('ManualJournal' vs 'Journal').
 */
export const toLedgerReferenceType = (referenceType: string): string =>
  referenceType === 'ManualJournal' ? 'Journal' : referenceType;

/**
 * Rounds to 2 decimals, half away from zero. Robust to binary floating point
 * (1.005 is stored as 1.00499999999999989...): the scaled value is first
 * normalised to 15 significant digits, then rounded on the absolute value.
 */
export const roundAmount = (value: number): number => {
  const abs = Math.abs(value);
  const scaled = Number((abs * 100).toPrecision(15));
  const rounded = Math.round(scaled) / 100;
  return value < 0 && rounded !== 0 ? -rounded : rounded;
};

/**
 * Net of the non-cash-basis lines on the account, signed in the account's
 * normal direction, rounded to cents.
 */
export const netAmountOnAccount = (
  lines: LedgerLine[],
  accountNormal: AccountNormal,
): number => {
  const net = lines
    .filter((line) => line.basis !== 'cash')
    .reduce(
      (sum, line) =>
        sum +
        (accountNormal === 'debit'
          ? line.debit - line.credit
          : line.credit - line.debit),
      0,
    );
  return roundAmount(net);
};

export const computeClearedBalance = (
  beginningBalance: number,
  selectedAmounts: number[],
): number =>
  roundAmount(
    selectedAmounts.reduce((sum, amount) => sum + amount, beginningBalance),
  );

export const computeDifference = (
  endingBalance: number,
  clearedBalance: number,
): number => roundAmount(endingBalance - clearedBalance);

export const validateStatementDate = (
  statementDate: string,
  lastStatementDate: string | null,
): string | null =>
  lastStatementDate !== null && statementDate <= lastStatementDate
    ? ERRORS.STATEMENT_DATE_NOT_AFTER_LAST
    : null;

export const validateAccount = (
  accountType: string,
  accountCurrency: string,
  baseCurrency: string,
): string | null => {
  if (!RECONCILABLE_ACCOUNT_TYPES.includes(accountType)) {
    return ERRORS.ACCOUNT_NOT_RECONCILABLE;
  }
  if (accountCurrency !== baseCurrency) {
    return ERRORS.FOREIGN_CURRENCY;
  }
  return null;
};

export const validateFinish = (input: FinishCheckInput): string | null => {
  const accountError = validateAccount(
    input.accountType,
    input.accountCurrency,
    input.baseCurrency,
  );
  if (accountError) return accountError;

  const dateError = validateStatementDate(
    input.statementDate,
    input.lastStatementDate,
  );
  if (dateError) return dateError;

  const amounts: number[] = [];
  for (const ref of input.selected) {
    const key = refKey(ref);
    if (!input.eligibleAmounts.has(key)) {
      return ERRORS.TRANSACTION_NOT_ON_ACCOUNT;
    }
    if (input.reconciledKeys.has(key)) {
      return ERRORS.TRANSACTION_ALREADY_RECONCILED;
    }
    amounts.push(input.eligibleAmounts.get(key));
  }
  const cleared = computeClearedBalance(input.beginningBalance, amounts);
  return computeDifference(input.endingBalance, cleared) !== 0
    ? ERRORS.DIFFERENCE_NOT_ZERO
    : null;
};

/**
 * Reconciled transactions whose amount changed or that no longer exist.
 */
export const findChangedReconciled = (
  snapshots: ReconciledSnapshot[],
  currentAmounts: Map<string, number>,
): ChangedReconciledItem[] => {
  const changed: ChangedReconciledItem[] = [];
  for (const snapshot of snapshots) {
    const key = refKey(snapshot);
    if (!currentAmounts.has(key)) {
      changed.push({ ...snapshot, currentAmount: 0, isDeleted: true });
      continue;
    }
    const currentAmount = roundAmount(currentAmounts.get(key));
    if (currentAmount !== roundAmount(snapshot.amount)) {
      changed.push({ ...snapshot, currentAmount, isDeleted: false });
    }
  }
  return changed;
};

/**
 * The target reconciliation and every one with a later statement date.
 */
export const selectReconciliationsToUndo = (
  completed: Array<{ id: number; statementDate: string }>,
  targetId: number,
): number[] => {
  const target = completed.find((item) => item.id === targetId);
  if (!target) return [];
  return completed
    .filter(
      (item) =>
        item.id === targetId || item.statementDate > target.statementDate,
    )
    .map((item) => item.id);
};

export const shouldTakeOver = (args: {
  storedBankRowIds: number[];
  linkedBankRowIds: number[];
  oldTransactionOnAccount: boolean;
  newTransactionOnAccount: boolean;
  newTransactionReconciled: boolean;
}): boolean => {
  const stored = new Set(args.storedBankRowIds);
  const linked = new Set(args.linkedBankRowIds);
  const sameRows =
    stored.size > 0 &&
    stored.size === linked.size &&
    [...stored].every((id) => linked.has(id));
  return (
    sameRows &&
    !args.oldTransactionOnAccount &&
    args.newTransactionOnAccount &&
    !args.newTransactionReconciled
  );
};

export const resolveReconcileStatus = (
  key: string,
  sets: {
    reconciled: Set<string>;
    draftSelected: Set<string>;
    fromBankFeed: Set<string>;
  },
): ReconcileStatus => {
  if (sets.reconciled.has(key)) return 'reconciled';
  if (sets.fromBankFeed.has(key) || sets.draftSelected.has(key)) {
    return 'cleared';
  }
  return 'none';
};

export const preselectRefs = (
  rows: Array<ReconcileRef & { date: string; isFromBankFeed: boolean }>,
  statementDate: string,
  draftSelection: ReconcileRef[] | null,
): { selected: ReconcileRef[]; droppedCount: number } => {
  if (draftSelection === null) {
    return {
      selected: rows
        .filter((row) => row.isFromBankFeed && row.date <= statementDate)
        .map(({ referenceType, referenceId }) => ({
          referenceType,
          referenceId,
        })),
      droppedCount: 0,
    };
  }
  const existing = new Set(rows.map(refKey));
  const selected = draftSelection.filter((ref) => existing.has(refKey(ref)));
  return { selected, droppedCount: draftSelection.length - selected.length };
};
