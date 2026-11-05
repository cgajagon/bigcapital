import { Inject, Injectable, Scope } from '@nestjs/common';
import { ICashflowAccountTransactionsQuery } from '../../types/BankingTransactions.types';
import {
  groupMatchedBankTransactions,
  groupUncategorizedTransactions,
} from './_utils';
import { TenantModelProxy } from '@/modules/System/models/TenantBaseModel';
import { AccountTransaction } from '@/modules/Accounts/models/AccountTransaction.model';
import { UncategorizedBankTransaction } from '../../models/UncategorizedBankTransaction';
import { MatchedBankTransaction } from '@/modules/BankingMatching/models/MatchedBankTransaction';
import { BankReconciliation } from '@/modules/BankReconciliation/models/BankReconciliation';
import { BankReconciliationTransaction } from '@/modules/BankReconciliation/models/BankReconciliationTransaction';
import { BankReconciliationStatus } from '@/modules/BankReconciliation/types';
import {
  refKey,
  toLedgerReferenceType,
} from '@/modules/BankReconciliation/_utils';

@Injectable({ scope: Scope.REQUEST })
export class GetBankAccountTransactionsRepository {
  public query: ICashflowAccountTransactionsQuery;
  public transactions: any;
  public uncategorizedTransactions: any;
  public uncategorizedTransactionsMapByRef: Map<string, any>;
  public matchedBankTransactions: any;
  public matchedBankTransactionsMapByRef: Map<string, any>;
  public pagination: any;
  public openingBalance: any;
  public reconcileStatusSets: {
    reconciled: Set<string>;
    draftSelected: Set<string>;
    fromBankFeed: Set<string>;
  };

  /**
   * @param {TenantModelProxy<typeof AccountTransaction>} accountTransactionModel - Account transaction model.
   * @param {TenantModelProxy<typeof UncategorizedBankTransaction>} uncategorizedBankTransactionModel - Uncategorized transaction model
   * @param {TenantModelProxy<typeof MatchedBankTransaction>} matchedBankTransactionModel - Matched bank transaction model.
   * @param {TenantModelProxy<typeof BankReconciliationTransaction>} bankReconciliationTransactionModel - Reconciled transaction model.
   * @param {TenantModelProxy<typeof BankReconciliation>} bankReconciliationModel - Bank reconciliation model.
   */
  constructor(
    @Inject(AccountTransaction.name)
    private readonly accountTransactionModel: TenantModelProxy<
      typeof AccountTransaction
    >,

    @Inject(UncategorizedBankTransaction.name)
    private readonly uncategorizedBankTransactionModel: TenantModelProxy<
      typeof UncategorizedBankTransaction
    >,

    @Inject(MatchedBankTransaction.name)
    private readonly matchedBankTransactionModel: TenantModelProxy<
      typeof MatchedBankTransaction
    >,

    @Inject(BankReconciliationTransaction.name)
    private readonly bankReconciliationTransactionModel: TenantModelProxy<
      typeof BankReconciliationTransaction
    >,

    @Inject(BankReconciliation.name)
    private readonly bankReconciliationModel: TenantModelProxy<
      typeof BankReconciliation
    >,
  ) {}

  setQuery(query: ICashflowAccountTransactionsQuery) {
    this.query = query;
  }

  /**
   * Async initalize the resources.
   */
  async asyncInit() {
    await this.initCashflowAccountTransactions();
    await this.initCashflowAccountOpeningBalance();
    await this.initCategorizedTransactions();
    await this.initMatchedTransactions();
    await this.initReconcileStatuses();
  }

  /**
   * Retrieve the cashflow account transactions.
   * @param {number} tenantId -
   * @param {ICashflowAccountTransactionsQuery} query -
   */
  async initCashflowAccountTransactions() {
    const { results, pagination } = await this.accountTransactionModel()
      .query()
      .where('account_id', this.query.accountId)
      .orderBy([
        { column: 'date', order: 'desc' },
        { column: 'created_at', order: 'desc' },
      ])
      .pagination(this.query.page - 1, this.query.pageSize);

    this.transactions = results;
    this.pagination = pagination;
  }

  /**
   * Retrieve the cashflow account opening balance.
   * @param {number} tenantId
   * @param {number} accountId
   * @param {IPaginationMeta} pagination
   * @return {Promise<number>}
   */
  async initCashflowAccountOpeningBalance(): Promise<void> {
    // Retrieve the opening balance of credit and debit balances.
    const openingBalancesSubquery = this.accountTransactionModel()
      .query()
      .where('account_id', this.query.accountId)
      .orderBy([
        { column: 'date', order: 'desc' },
        { column: 'created_at', order: 'desc' },
      ])
      .limit(this.pagination.total)
      .offset(this.pagination.pageSize * (this.pagination.page - 1));

    // Sumation of credit and debit balance.
    const openingBalances = await this.accountTransactionModel()
      .query()
      .sum('credit as credit')
      .sum('debit as debit')
      .from(openingBalancesSubquery.as('T'))
      .first();

    const openingBalance = openingBalances.debit - openingBalances.credit;

    this.openingBalance = openingBalance;
  }

  /**
   * Initialize the uncategorized transactions of the bank account.
   */
  async initCategorizedTransactions() {
    const refs = this.transactions.map((t) => [t.referenceType, t.referenceId]);
    const uncategorizedTransactions =
      await this.uncategorizedBankTransactionModel()
        .query()
        .whereIn(['categorizeRefType', 'categorizeRefId'], refs);

    this.uncategorizedTransactions = uncategorizedTransactions;
    this.uncategorizedTransactionsMapByRef = groupUncategorizedTransactions(
      uncategorizedTransactions,
    );
  }

  /**
   * Initialize the matched bank transactions of the bank account.
   */
  async initMatchedTransactions(): Promise<void> {
    const refs = this.transactions.map((t) => [t.referenceType, t.referenceId]);

    const matchedBankTransactions = await this.matchedBankTransactionModel()
      .query()
      .whereIn(['referenceType', 'referenceId'], refs);
    this.matchedBankTransactions = matchedBankTransactions;
    this.matchedBankTransactionsMapByRef = groupMatchedBankTransactions(
      matchedBankTransactions,
    );
  }

  /**
   * Initialize the sets the reconcile (R/C) status of the page rows is
   * resolved from. Must run after the categorized and matched initializers.
   */
  async initReconcileStatuses(): Promise<void> {
    const refs = this.transactions.map((t) => [t.referenceType, t.referenceId]);

    const reconciledRows = await this.bankReconciliationTransactionModel()
      .query()
      .where('account_id', this.query.accountId)
      .whereIn(['referenceType', 'referenceId'], refs);

    const draft = await this.bankReconciliationModel()
      .query()
      .where('account_id', this.query.accountId)
      .where('status', BankReconciliationStatus.Draft)
      .first();

    // Ledger rows store manual journals as 'Journal' while matched rows store
    // 'ManualJournal'.
    const fromBankFeed = new Set<string>([
      ...this.uncategorizedTransactionsMapByRef.keys(),
      ...this.matchedBankTransactions.map((matched) =>
        refKey({
          referenceType: toLedgerReferenceType(matched.referenceType),
          referenceId: matched.referenceId,
        }),
      ),
    ]);

    this.reconcileStatusSets = {
      reconciled: new Set(reconciledRows.map(refKey)),
      draftSelected: new Set((draft?.selectedTransactions ?? []).map(refKey)),
      fromBankFeed,
    };
  }
}
