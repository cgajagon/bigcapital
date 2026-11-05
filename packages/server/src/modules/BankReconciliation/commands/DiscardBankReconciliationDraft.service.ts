import { Inject, Injectable } from '@nestjs/common';
import { Knex } from 'knex';
import { ServiceError } from '@/modules/Items/ServiceError';
import { TenantModelProxy } from '@/modules/System/models/TenantBaseModel';
import { Account } from '@/modules/Accounts/models/Account.model';
import { UnitOfWork } from '@/modules/Tenancy/TenancyDB/UnitOfWork.service';
import { BankReconciliationRepository } from '../BankReconciliationRepository';
import { BankReconciliation } from '../models/BankReconciliation';
import { ERRORS } from '../types';

@Injectable()
export class DiscardBankReconciliationDraft {
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
   * Deletes the account's draft. A no-op when there is none.
   */
  public async discard(accountId: number): Promise<void> {
    await this.uow.withTransaction(async (trx: Knex.Transaction) => {
      const locked = await this.accountModel()
        .query(trx)
        .findById(accountId)
        .forUpdate();
      if (!locked) {
        throw new ServiceError(ERRORS.NOT_FOUND);
      }
      const draft = await this.repository.getDraft(accountId, trx);
      if (draft) {
        await this.bankReconciliationModel().query(trx).deleteById(draft.id);
      }
    });
  }
}
