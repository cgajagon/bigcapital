import { Inject, Injectable } from '@nestjs/common';
import { Knex } from 'knex';
import { uniqBy } from 'lodash';
import { ServiceError } from '@/modules/Items/ServiceError';
import { TenantModelProxy } from '@/modules/System/models/TenantBaseModel';
import { Account } from '@/modules/Accounts/models/Account.model';
import { UnitOfWork } from '@/modules/Tenancy/TenancyDB/UnitOfWork.service';
import {
  BankReconciliationRepository,
  toDateString,
} from '../BankReconciliationRepository';
import { BankReconciliation } from '../models/BankReconciliation';
import { BankReconciliationInputDto } from '../dtos/BankReconciliationInput.dto';
import { refKey, validateStatementDate } from '../_utils';
import { BankReconciliationStatus, ERRORS } from '../types';

@Injectable()
export class SaveBankReconciliationDraft {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly repository: BankReconciliationRepository,

    @Inject(Account.name)
    private readonly accountModel: TenantModelProxy<typeof Account>,

    @Inject(BankReconciliation.name)
    private readonly bankReconciliationModel: TenantModelProxy<
      typeof BankReconciliation
    >,
  ) {}

  /**
   * Upserts the single draft of the account. The ticks live only in the
   * draft's `selected_transactions` JSON.
   */
  public async save(
    accountId: number,
    dto: BankReconciliationInputDto,
  ): Promise<{ id: number }> {
    return this.uow.withTransaction(async (trx: Knex.Transaction) => {
      const locked = await this.accountModel()
        .query(trx)
        .findById(accountId)
        .forUpdate();
      if (!locked) {
        throw new ServiceError(ERRORS.NOT_FOUND);
      }
      await this.repository.getAccountOrThrow(accountId, trx);

      const lastCompleted = await this.repository.getLastCompleted(
        accountId,
        trx,
      );
      const dateError = validateStatementDate(
        dto.statementDate,
        lastCompleted ? toDateString(lastCompleted.statementDate) : null,
      );
      if (dateError) {
        throw new ServiceError(dateError);
      }
      const selected = uniqBy(
        dto.selectedTransactions.map(({ referenceType, referenceId }) => ({
          referenceType,
          referenceId,
        })),
        refKey,
      );
      const values = {
        statementDate: dto.statementDate,
        endingBalance: dto.endingBalance,
        selectedTransactions: selected,
      };
      const draft = await this.repository.getDraft(accountId, trx);

      if (draft) {
        await this.bankReconciliationModel()
          .query(trx)
          .findById(draft.id)
          .patch(values);
        return { id: draft.id };
      }
      const inserted = await this.bankReconciliationModel()
        .query(trx)
        .insert({
          accountId,
          status: BankReconciliationStatus.Draft,
          ...values,
        });
      return { id: inserted.id };
    });
  }
}
