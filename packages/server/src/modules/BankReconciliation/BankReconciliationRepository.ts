import { Inject, Injectable } from '@nestjs/common';
import * as moment from 'moment';
import { groupBy } from 'lodash';
import { ServiceError } from '@/modules/Items/ServiceError';
import { TenantModelProxy } from '@/modules/System/models/TenantBaseModel';
import { Account } from '@/modules/Accounts/models/Account.model';
import { AccountTransaction } from '@/modules/Accounts/models/AccountTransaction.model';
import { UncategorizedBankTransaction } from '@/modules/BankingTransactions/models/UncategorizedBankTransaction';
import { MatchedBankTransaction } from '@/modules/BankingMatching/models/MatchedBankTransaction';
import { TenancyContext } from '@/modules/Tenancy/TenancyContext.service';
import { AccountingBasis } from '@/common/types/AccountingBasis';
import { BankReconciliation } from './models/BankReconciliation';
import { BankReconciliationTransaction } from './models/BankReconciliationTransaction';
import { netAmountOnAccount, refKey, validateAccount } from './_utils';
import {
  AccountNormal,
  BankReconciliationStatus,
  ERRORS,
  ReconcileRef,
} from './types';

export type LedgerTransactionSummary = ReconcileRef & {
  date: string;
  amount: number;
  transactionTypeKey: string | null;
  transactionNumber: string | null;
  referenceNumber: string | null;
  contactName: string | null;
  description: string | null;
};

export const toDateString = (value: Date | string): string =>
  moment(value).format('YYYY-MM-DD');

@Injectable()
export class BankReconciliationRepository {
  constructor(
    private readonly tenancyContext: TenancyContext,

    @Inject(Account.name)
    private readonly accountModel: TenantModelProxy<typeof Account>,

    @Inject(AccountTransaction.name)
    private readonly accountTransactionModel: TenantModelProxy<
      typeof AccountTransaction
    >,

    @Inject(UncategorizedBankTransaction.name)
    private readonly uncategorizedTransactionModel: TenantModelProxy<
      typeof UncategorizedBankTransaction
    >,

    @Inject(MatchedBankTransaction.name)
    private readonly matchedTransactionModel: TenantModelProxy<
      typeof MatchedBankTransaction
    >,

    @Inject(BankReconciliation.name)
    private readonly bankReconciliationModel: TenantModelProxy<
      typeof BankReconciliation
    >,

    @Inject(BankReconciliationTransaction.name)
    private readonly bankReconciliationTransactionModel: TenantModelProxy<
      typeof BankReconciliationTransaction
    >,
  ) {}

  /**
   * Retrieves the organization base currency.
   */
  public async getBaseCurrency(): Promise<string> {
    const metadata = await this.tenancyContext.getTenantMetadata();
    return metadata.baseCurrency;
  }

  /**
   * Retrieves the account without validating it can be reconciled.
   * @throws {ServiceError} NOT_FOUND when the account doesn't exist.
   */
  public async getAccount(accountId: number, trx?): Promise<Account> {
    const account = await this.accountModel().query(trx).findById(accountId);
    if (!account) {
      throw new ServiceError(ERRORS.NOT_FOUND);
    }
    return account;
  }

  /**
   * Retrieves the account, throwing when it can't be reconciled (wrong type
   * or not in the base currency).
   */
  public async getAccountOrThrow(accountId: number, trx?): Promise<Account> {
    const account = await this.getAccount(accountId, trx);
    const baseCurrency = await this.getBaseCurrency();

    const error = validateAccount(
      account.accountType,
      account.currencyCode,
      baseCurrency,
    );
    if (error) {
      throw new ServiceError(error);
    }
    return account;
  }

  /**
   * Completed reconciliations of the account, statement date descending.
   */
  public async getCompleted(
    accountId: number,
    trx?,
  ): Promise<BankReconciliation[]> {
    return this.bankReconciliationModel()
      .query(trx)
      .where('account_id', accountId)
      .where('status', BankReconciliationStatus.Completed)
      .orderBy([
        { column: 'statement_date', order: 'desc' },
        { column: 'id', order: 'desc' },
      ]);
  }

  public async getLastCompleted(
    accountId: number,
    trx?,
  ): Promise<BankReconciliation | null> {
    const completed = await this.getCompleted(accountId, trx);
    return completed[0] ?? null;
  }

  public async getDraft(
    accountId: number,
    trx?,
  ): Promise<BankReconciliation | null> {
    const draft = await this.bankReconciliationModel()
      .query(trx)
      .where('account_id', accountId)
      .where('status', BankReconciliationStatus.Draft)
      .first();
    return draft ?? null;
  }

  /**
   * Every transaction of the account held by a completed reconciliation.
   */
  public async getReconciledTransactions(
    accountId: number,
    trx?,
  ): Promise<BankReconciliationTransaction[]> {
    return this.bankReconciliationTransactionModel()
      .query(trx)
      .where('account_id', accountId)
      .orderBy('id');
  }

  /**
   * One summary per source transaction on the account: the net amount of its
   * ledger lines (cash-basis rows ignored), plus display fields taken from its
   * first line. Keyed by `refKey`.
   */
  public async getLedgerSummaries(
    account: Account,
    trx?,
  ): Promise<Map<string, LedgerTransactionSummary>> {
    const lines = (await this.accountTransactionModel()
      .query(trx)
      .where('account_id', account.id)
      .modify('filterByBasis', AccountingBasis.Accrual)
      .withGraphFetched('contact')
      .orderBy('id')) as AccountTransaction[];

    const grouped: Record<string, AccountTransaction[]> = groupBy(
      lines,
      (line) => refKey(line),
    );
    const summaries = new Map<string, LedgerTransactionSummary>();

    for (const key of Object.keys(grouped)) {
      const group = grouped[key];
      const first = group[0];
      summaries.set(key, {
        referenceType: first.referenceType,
        referenceId: first.referenceId,
        date: toDateString(first.date),
        amount: netAmountOnAccount(
          group.map((line) => ({
            debit: Number(line.debit) || 0,
            credit: Number(line.credit) || 0,
            basis: line.basis as any,
          })),
          account.accountNormal as AccountNormal,
        ),
        transactionTypeKey: first.referenceTypeFormatted ?? null,
        transactionNumber: first.transactionNumber ?? null,
        referenceNumber: first.referenceNumber ?? null,
        contactName: (first as any).contact?.displayName ?? null,
        description: first.note ?? null,
      });
    }
    return summaries;
  }

  /**
   * Transactions linked to bank feed rows of the account, by categorization or
   * by matching: refKey -> uncategorized row ids.
   */
  public async getBankFeedLinks(
    accountId: number,
    trx?,
  ): Promise<Map<string, number[]>> {
    const links = new Map<string, number[]>();
    const add = (key: string, id: number) => {
      const ids = links.get(key) ?? [];
      if (!ids.includes(id)) ids.push(id);
      links.set(key, ids);
    };

    const categorized = await this.uncategorizedTransactionModel()
      .query(trx)
      .where('account_id', accountId)
      .whereNotNull('categorize_ref_type')
      .whereNotNull('categorize_ref_id');

    for (const row of categorized) {
      add(
        refKey({
          referenceType: row.categorizeRefType,
          referenceId: row.categorizeRefId,
        }),
        row.id,
      );
    }

    const matched = await this.matchedTransactionModel()
      .query(trx)
      .whereIn(
        'uncategorized_transaction_id',
        this.uncategorizedTransactionModel()
          .query(trx)
          .where('account_id', accountId)
          .select('id'),
      );

    for (const row of matched) {
      add(
        refKey({
          referenceType: row.referenceType,
          referenceId: row.referenceId,
        }),
        row.uncategorizedTransactionId,
      );
    }
    return links;
  }

  /**
   * Bank rows dated on or before the statement date that are not in the books
   * yet: not excluded, not pending, neither categorized nor matched.
   */
  public async countUncategorized(
    accountId: number,
    statementDate: string,
    trx?,
  ): Promise<number> {
    const result = await this.uncategorizedTransactionModel()
      .query(trx)
      .where('account_id', accountId)
      .modify('notExcluded')
      .modify('notPending')
      .modify('toDate', statementDate)
      .whereNull('categorize_ref_type')
      .whereNull('categorize_ref_id')
      .whereNotIn(
        'id',
        this.matchedTransactionModel()
          .query(trx)
          .select('uncategorized_transaction_id'),
      )
      .count('id as count')
      .first();

    return Number((result as any)?.count ?? 0);
  }
}
