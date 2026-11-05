import { Inject, Injectable } from '@nestjs/common';
import { Knex } from 'knex';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { uniqBy } from 'lodash';
import { events } from '@/common/events/events';
import { ServiceError } from '@/modules/Items/ServiceError';
import { TenantModelProxy } from '@/modules/System/models/TenantBaseModel';
import { Account } from '@/modules/Accounts/models/Account.model';
import { TenantUser } from '@/modules/Tenancy/TenancyModels/models/TenantUser.model';
import { TenancyContext } from '@/modules/Tenancy/TenancyContext.service';
import { UnitOfWork } from '@/modules/Tenancy/TenancyDB/UnitOfWork.service';
import {
  BankReconciliationRepository,
  toDateString,
} from '../BankReconciliationRepository';
import { BankReconciliation } from '../models/BankReconciliation';
import { BankReconciliationTransaction } from '../models/BankReconciliationTransaction';
import { BankReconciliationBankRow } from '../models/BankReconciliationBankRow';
import { BankReconciliationInputDto } from '../dtos/BankReconciliationInput.dto';
import {
  isDuplicateEntryError,
  refKey,
  roundAmount,
  validateFinish,
} from '../_utils';
import { BankReconciliationStatus, ERRORS, FinishCheckInput } from '../types';

const sum = (values: number[]): number =>
  roundAmount(values.reduce((total, value) => total + value, 0));

@Injectable()
export class FinishBankReconciliation {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly eventPublisher: EventEmitter2,
    private readonly repository: BankReconciliationRepository,
    private readonly tenancyContext: TenancyContext,

    @Inject(Account.name)
    private readonly accountModel: TenantModelProxy<typeof Account>,

    @Inject(TenantUser.name)
    private readonly tenantUserModel: TenantModelProxy<typeof TenantUser>,

    @Inject(BankReconciliation.name)
    private readonly bankReconciliationModel: TenantModelProxy<
      typeof BankReconciliation
    >,

    @Inject(BankReconciliationTransaction.name)
    private readonly bankReconciliationTransactionModel: TenantModelProxy<
      typeof BankReconciliationTransaction
    >,

    @Inject(BankReconciliationBankRow.name)
    private readonly bankReconciliationBankRowModel: TenantModelProxy<
      typeof BankReconciliationBankRow
    >,
  ) {}

  /**
   * Finishes the reconciliation: re-checks everything against the current
   * ledger, records the snapshot and removes the account's draft.
   */
  public async finish(
    accountId: number,
    dto: BankReconciliationInputDto,
  ): Promise<{ id: number }> {
    // The tenant user of the request, stored as the completer.
    const systemUser = await this.tenancyContext.getSystemUser();
    const tenantUser = await this.tenantUserModel()
      .query()
      .findOne('systemUserId', systemUser.id);

    return this.uow.withTransaction(async (trx: Knex.Transaction) => {
      const locked = await this.accountModel()
        .query(trx)
        .findById(accountId)
        .forUpdate();
      if (!locked) {
        throw new ServiceError(ERRORS.NOT_FOUND);
      }
      const account = await this.repository.getAccountOrThrow(accountId, trx);
      const baseCurrency = await this.repository.getBaseCurrency();

      const lastCompleted = await this.repository.getLastCompleted(
        accountId,
        trx,
      );
      const reconciledRows = await this.repository.getReconciledTransactions(
        accountId,
        trx,
      );
      const ledger = await this.repository.getLedgerSummaries(account, trx);
      const bankLinks = await this.repository.getBankFeedLinks(accountId, trx);

      // A duplicated tick must not count twice.
      const selected = uniqBy(
        dto.selectedTransactions.map(({ referenceType, referenceId }) => ({
          referenceType,
          referenceId,
        })),
        refKey,
      );
      const reconciledKeys = new Set(reconciledRows.map(refKey));

      // Every transaction currently on the account (reconciled ones included,
      // so a re-ticked one reports ALREADY_RECONCILED, not NOT_ON_ACCOUNT).
      const eligibleAmounts = new Map<string, number>(
        [...ledger.entries()].map(([key, row]) => [key, row.amount]),
      );
      const beginningBalance = this.repository.computeBeginningBalance(
        reconciledRows,
        ledger,
      );

      const input: FinishCheckInput = {
        accountType: account.accountType,
        accountCurrency: account.currencyCode,
        baseCurrency,
        statementDate: dto.statementDate,
        lastStatementDate: lastCompleted
          ? toDateString(lastCompleted.statementDate)
          : null,
        beginningBalance,
        endingBalance: dto.endingBalance,
        selected,
        eligibleAmounts,
        reconciledKeys,
      };
      const error = validateFinish(input);
      if (error) {
        throw new ServiceError(error);
      }

      // Totals (spec 5.9).
      const selectedKeys = new Set(selected.map(refKey));
      const selectedAmounts = selected.map(
        (ref) => ledger.get(refKey(ref)).amount,
      );
      const uncleared = [...ledger.entries()]
        .filter(
          ([key, row]) =>
            !reconciledKeys.has(key) &&
            !selectedKeys.has(key) &&
            row.date <= dto.statementDate,
        )
        .map(([, row]) => row.amount);

      const header = await this.bankReconciliationModel()
        .query(trx)
        .insert({
          accountId,
          statementDate: dto.statementDate,
          endingBalance: dto.endingBalance,
          status: BankReconciliationStatus.Completed,
          selectedTransactions: null,
          beginningBalance,
          clearedIncreases: sum(selectedAmounts.filter((a) => a > 0)),
          // Stored as a positive magnitude.
          clearedDecreases: Math.abs(sum(selectedAmounts.filter((a) => a < 0))),
          bookBalance: sum(
            [...ledger.values()]
              .filter((row) => row.date <= dto.statementDate)
              .map((row) => row.amount),
          ),
          unclearedCount: uncleared.length,
          unclearedTotal: sum(uncleared),
          completedAt: new Date(),
          completedByUserId: tenantUser?.id ?? null,
        });

      try {
        for (const ref of selected) {
          const key = refKey(ref);
          const row = ledger.get(key);
          const stored = await this.bankReconciliationTransactionModel()
            .query(trx)
            .insert({
              reconciliationId: header.id,
              accountId,
              referenceType: row.referenceType,
              referenceId: row.referenceId,
              amount: row.amount,
              date: row.date,
              transactionTypeKey: row.transactionTypeKey,
              transactionNumber: row.transactionNumber,
              referenceNumber: row.referenceNumber,
              contactName: row.contactName,
            });
          for (const uncategorizedId of bankLinks.get(key) ?? []) {
            await this.bankReconciliationBankRowModel().query(trx).insert({
              reconciliationTransactionId: stored.id,
              uncategorizedTransactionId: uncategorizedId,
            });
          }
        }
      } catch (error) {
        // A concurrent finish ticked the same transaction first.
        if (isDuplicateEntryError(error)) {
          throw new ServiceError(ERRORS.TRANSACTION_ALREADY_RECONCILED);
        }
        throw error;
      }

      const draft = await this.repository.getDraft(accountId, trx);
      if (draft) {
        await this.bankReconciliationModel().query(trx).deleteById(draft.id);
      }

      await this.eventPublisher.emitAsync(
        events.bankReconciliation.onFinished,
        { reconciliationId: header.id, accountId, trx },
      );
      return { id: header.id };
    });
  }
}
