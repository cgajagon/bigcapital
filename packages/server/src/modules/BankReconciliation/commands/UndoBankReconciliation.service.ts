import { Inject, Injectable } from '@nestjs/common';
import { Knex } from 'knex';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { events } from '@/common/events/events';
import { ServiceError } from '@/modules/Items/ServiceError';
import { TenantModelProxy } from '@/modules/System/models/TenantBaseModel';
import { Account } from '@/modules/Accounts/models/Account.model';
import { UnitOfWork } from '@/modules/Tenancy/TenancyDB/UnitOfWork.service';
import {
  BankReconciliationRepository,
  toDateString,
} from '../BankReconciliationRepository';
import { BankReconciliation } from '../models/BankReconciliation';
import { selectReconciliationsToUndo } from '../_utils';
import { BankReconciliationStatus, ERRORS } from '../types';

@Injectable()
export class UndoBankReconciliation {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly eventPublisher: EventEmitter2,
    private readonly repository: BankReconciliationRepository,

    @Inject(Account.name)
    private readonly accountModel: TenantModelProxy<typeof Account>,

    @Inject(BankReconciliation.name)
    private readonly bankReconciliationModel: TenantModelProxy<
      typeof BankReconciliation
    >,
  ) {}

  /**
   * Undoes the reconciliation and every later one of the account, and
   * discards the account's draft. Only the reconciliation records are
   * deleted (their rows cascade); ledger rows and source transactions are
   * never touched.
   * @throws {ServiceError} NOT_FOUND for an unknown id or a draft's id.
   */
  public async undo(
    reconciliationId: number,
  ): Promise<{ undoneIds: number[] }> {
    return this.uow.withTransaction(async (trx: Knex.Transaction) => {
      // The account is only known through the reconciliation: find it first,
      // then lock the account row and read the list again under the lock.
      const target = await this.bankReconciliationModel()
        .query(trx)
        .findById(reconciliationId);
      if (!target || target.status !== BankReconciliationStatus.Completed) {
        throw new ServiceError(ERRORS.NOT_FOUND);
      }
      const accountId = target.accountId;

      const locked = await this.accountModel()
        .query(trx)
        .findById(accountId)
        .forUpdate();
      if (!locked) {
        throw new ServiceError(ERRORS.NOT_FOUND);
      }

      const completed = await this.repository.getCompleted(accountId, trx);
      const undoneIds = selectReconciliationsToUndo(
        completed.map((item) => ({
          id: item.id,
          statementDate: toDateString(item.statementDate),
        })),
        reconciliationId,
      );
      // Undone by someone else while this request waited for the lock.
      if (!undoneIds.length) {
        throw new ServiceError(ERRORS.NOT_FOUND);
      }

      const draft = await this.repository.getDraft(accountId, trx);
      const toDelete = draft ? [...undoneIds, draft.id] : undoneIds;
      await this.bankReconciliationModel()
        .query(trx)
        .whereIn('id', toDelete)
        .delete();

      await this.eventPublisher.emitAsync(events.bankReconciliation.onUndone, {
        undoneIds,
        accountId,
        trx,
      });
      return { undoneIds };
    });
  }
}
