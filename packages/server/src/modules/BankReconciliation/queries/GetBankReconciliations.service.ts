import { Inject, Injectable } from '@nestjs/common';
import * as moment from 'moment';
import { TenantModelProxy } from '@/modules/System/models/TenantBaseModel';
import { TenantUser } from '@/modules/Tenancy/TenancyModels/models/TenantUser.model';
import {
  BankReconciliationRepository,
  toDateString,
} from '../BankReconciliationRepository';
import { BankReconciliationListItemDto } from '../dtos/BankReconciliationResponses.dto';

@Injectable()
export class GetBankReconciliations {
  constructor(
    private readonly repository: BankReconciliationRepository,

    @Inject(TenantUser.name)
    private readonly tenantUserModel: TenantModelProxy<typeof TenantUser>,
  ) {}

  /**
   * Completed reconciliations of the account, newest first.
   */
  public async getList(
    accountId: number,
  ): Promise<BankReconciliationListItemDto[]> {
    const completed = await this.repository.getCompleted(accountId);

    const userIds = [
      ...new Set(
        completed
          .map((row) => row.completedByUserId)
          .filter((id) => id !== null && id !== undefined),
      ),
    ];
    const users = userIds.length
      ? await this.tenantUserModel().query().whereIn('id', userIds)
      : [];
    const names = new Map<number, string>(
      users.map((user) => [user.id, user.fullName]),
    );

    return completed.map((row) => ({
      id: row.id,
      statementDate: toDateString(row.statementDate),
      endingBalance: Number(row.endingBalance),
      completedAt: row.completedAt
        ? moment(row.completedAt).toISOString()
        : null,
      completedByUserId: row.completedByUserId ?? null,
      completedByName: names.get(row.completedByUserId) ?? null,
    }));
  }
}
