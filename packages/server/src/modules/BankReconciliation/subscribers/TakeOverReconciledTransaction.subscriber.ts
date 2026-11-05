import { Knex } from 'knex';
import { Inject, Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { uniq } from 'lodash';
import { events } from '@/common/events/events';
import { TenantModelProxy } from '@/modules/System/models/TenantBaseModel';
import { AccountTransaction } from '@/modules/Accounts/models/AccountTransaction.model';
import { MatchedBankTransaction } from '@/modules/BankingMatching/models/MatchedBankTransaction';
import { IBankTransactionMatchedEventPayload } from '@/modules/BankingMatching/types';
import { ICashflowTransactionCategorizedPayload } from '@/modules/BankingTransactions/types/BankingTransactions.types';
import { BankReconciliationTransaction } from '../models/BankReconciliationTransaction';
import { BankReconciliationBankRow } from '../models/BankReconciliationBankRow';
import { shouldTakeOver, toLedgerReferenceType } from '../_utils';
import { ReconcileRef } from '../types';

/**
 * The R follows the bank row (spec 5.7a): when every bank row of a reconciled
 * transaction is categorized or matched again to a new transaction on the
 * same account, the new transaction takes the old one's place in the
 * reconciliation. Every query runs in the event's transaction, so the
 * in-flight state is visible.
 */
@Injectable()
export class TakeOverReconciledTransaction {
  constructor(
    @Inject(BankReconciliationTransaction.name)
    private readonly bankReconciliationTransactionModel: TenantModelProxy<
      typeof BankReconciliationTransaction
    >,

    @Inject(BankReconciliationBankRow.name)
    private readonly bankReconciliationBankRowModel: TenantModelProxy<
      typeof BankReconciliationBankRow
    >,

    @Inject(AccountTransaction.name)
    private readonly accountTransactionModel: TenantModelProxy<
      typeof AccountTransaction
    >,

    @Inject(MatchedBankTransaction.name)
    private readonly matchedTransactionModel: TenantModelProxy<
      typeof MatchedBankTransaction
    >,
  ) {}

  /**
   * Bank rows categorized into a new cashflow transaction.
   */
  @OnEvent(events.cashflow.onTransactionCategorized, { suppressErrors: false })
  public async handleCategorized({
    cashflowTransaction,
    uncategorizedTransactions,
    trx,
  }: ICashflowTransactionCategorizedPayload): Promise<void> {
    await this.takeOver(
      uncategorizedTransactions.map((row) => row.id),
      {
        referenceType: 'CashflowTransaction',
        referenceId: cashflowTransaction.id,
      },
      trx,
    );
  }

  /**
   * Bank rows matched to a transaction. The stored matches hold the created
   * reference (a payment for an invoice), not the one in the payload.
   */
  @OnEvent(events.bankMatch.onMatched, { suppressErrors: false })
  public async handleMatched({
    uncategorizedTransactionIds,
    trx,
  }: IBankTransactionMatchedEventPayload): Promise<void> {
    const matched = await this.matchedTransactionModel()
      .query(trx)
      .whereIn('uncategorized_transaction_id', uncategorizedTransactionIds);

    const refs = uniq(
      matched.map((row) => `${row.referenceType}:${row.referenceId}`),
    );
    if (refs.length !== 1) return;

    await this.takeOver(
      uncategorizedTransactionIds,
      {
        referenceType: toLedgerReferenceType(matched[0].referenceType),
        referenceId: matched[0].referenceId,
      },
      trx,
    );
  }

  /**
   * Moves the reconciled rows whose bank rows are all linked to the new
   * reference onto it, keeping their snapshot.
   */
  private async takeOver(
    linkedBankRowIds: number[],
    newRef: ReconcileRef,
    trx?: Knex.Transaction,
  ): Promise<void> {
    if (linkedBankRowIds.length === 0) return;

    const linkedRows = await this.bankReconciliationBankRowModel()
      .query(trx)
      .whereIn('uncategorized_transaction_id', linkedBankRowIds);
    const candidateIds = uniq(
      linkedRows.map((r) => r.reconciliationTransactionId),
    );
    if (candidateIds.length === 0) return;

    const storedRows = await this.bankReconciliationBankRowModel()
      .query(trx)
      .whereIn('reconciliation_transaction_id', candidateIds);
    const reconciled = await this.bankReconciliationTransactionModel()
      .query(trx)
      .whereIn('id', candidateIds);

    for (const row of reconciled) {
      const takeOver = shouldTakeOver({
        storedBankRowIds: storedRows
          .filter((r) => r.reconciliationTransactionId === row.id)
          .map((r) => r.uncategorizedTransactionId),
        linkedBankRowIds,
        oldTransactionOnAccount: await this.isOnAccount(
          row.accountId,
          { referenceType: row.referenceType, referenceId: row.referenceId },
          trx,
        ),
        newTransactionOnAccount: await this.isOnAccount(
          row.accountId,
          newRef,
          trx,
        ),
        newTransactionReconciled:
          !!(await this.bankReconciliationTransactionModel()
            .query(trx)
            .where('account_id', row.accountId)
            .where('reference_type', newRef.referenceType)
            .where('reference_id', newRef.referenceId)
            .first()),
      });
      if (!takeOver) continue;

      await this.bankReconciliationTransactionModel()
        .query(trx)
        .findById(row.id)
        .patch({
          referenceType: newRef.referenceType,
          referenceId: newRef.referenceId,
        });
    }
  }

  /**
   * Whether the transaction has non cash basis lines on the account.
   */
  private async isOnAccount(
    accountId: number,
    ref: ReconcileRef,
    trx?: Knex.Transaction,
  ): Promise<boolean> {
    const line = await this.accountTransactionModel()
      .query(trx)
      .where('account_id', accountId)
      .where('reference_type', ref.referenceType)
      .where('reference_id', ref.referenceId)
      .where((builder) =>
        builder.whereNull('basis').orWhereNot('basis', 'cash'),
      )
      .first();
    return !!line;
  }
}
